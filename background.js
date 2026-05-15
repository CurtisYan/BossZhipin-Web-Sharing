const UPDATE_API_URL = "https://api.github.com/repos/CurtisYan/BossZhipin-Web-Sharing/releases/latest";
const UPDATE_PAGE_URL = "https://github.com/CurtisYan/BossZhipin-Web-Sharing/releases/latest";
const UPDATE_CACHE_KEY = "bossShareUpdateInfo";
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return false;

  if (message.type === "BOSS_FETCH_AS_DATA_URL") {
    fetchAsDataUrl(message.url)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "BOSS_CAPTURE_QR_FROM_URL") {
    captureQrFromUrl(message.url)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "BOSS_EXTRACT_JOB_FROM_URL") {
    extractJobFromUrl(message.url)
      .then((job) => sendResponse({ ok: true, job }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "BOSS_COPY_IMAGE_DATA_URL") {
    copyImageDataUrl(message.dataUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "BOSS_CHECK_UPDATE") {
    checkUpdate(Boolean(message.force))
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "BOSS_GET_CACHED_UPDATE") {
    getCachedUpdate()
      .then((info) => sendResponse({ ok: true, ...info }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  return false;
});

async function getCachedUpdate() {
  const currentVersion = chrome.runtime.getManifest().version;
  const stored = await chrome.storage.local.get({ [UPDATE_CACHE_KEY]: null });
  const cached = stored[UPDATE_CACHE_KEY];
  const now = Date.now();

  if (!cached?.checkedAt || cached.currentVersion !== currentVersion || now - cached.checkedAt >= UPDATE_CHECK_INTERVAL_MS) {
    return {
      checkedAt: 0,
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseUrl: UPDATE_PAGE_URL,
      assetUrl: ""
    };
  }

  return cached;
}

async function checkUpdate(force = false) {
  const currentVersion = chrome.runtime.getManifest().version;
  const stored = await chrome.storage.local.get({ [UPDATE_CACHE_KEY]: null });
  const cached = stored[UPDATE_CACHE_KEY];
  const now = Date.now();

  if (!force && cached?.checkedAt && cached.currentVersion === currentVersion && now - cached.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    return cached;
  }

  const fallback = {
    checkedAt: now,
    currentVersion,
    latestVersion: currentVersion,
    updateAvailable: false,
    releaseUrl: UPDATE_PAGE_URL,
    assetUrl: ""
  };

  try {
    const response = await fetch(UPDATE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    });

    if (response.status === 404) {
      await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: fallback });
      return fallback;
    }

    if (!response.ok) {
      throw new Error(`更新检查失败：${response.status}`);
    }

    const release = await response.json();
    const latestVersion = normalizeReleaseVersion(release.tag_name || release.name) || currentVersion;
    const asset = Array.isArray(release.assets) ? release.assets.find((item) => /\.zip$/i.test(item.name || "")) : null;
    const info = {
      checkedAt: now,
      currentVersion,
      latestVersion,
      tagName: release.tag_name || `v${latestVersion}`,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl: release.html_url || UPDATE_PAGE_URL,
      assetUrl: asset?.browser_download_url || ""
    };

    await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: info });
    return info;
  } catch (error) {
    if (cached) return { ...cached, error: error.message };
    return { ...fallback, error: error.message };
  }
}

async function captureQrFromUrl(url) {
  return withDetailTab(url, (tabId) => requestQrFromTab(tabId));
}

async function copyImageDataUrl(dataUrl) {
  if (!String(dataUrl || "").startsWith("data:image/png;base64,")) {
    throw new Error("不支持的图片数据");
  }

  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ type: "BOSS_OFFSCREEN_COPY_IMAGE", dataUrl });
  if (!response?.ok) {
    throw new Error(response?.error || "剪贴板写入失败");
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error("当前浏览器不支持后台剪贴板写入");
  }

  if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) {
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Copy generated job poster images to the clipboard after async extraction."
    });
  } catch (error) {
    if (!String(error?.message || "").includes("Only a single offscreen")) throw error;
  }
}

async function extractJobFromUrl(url) {
  return withDetailTab(url, (tabId) => requestJobFromTab(tabId));
}

async function withDetailTab(url, task) {
  const parsed = new URL(url);
  if (!isAllowedDetailUrl(parsed)) {
    throw new Error("不支持的职位详情地址");
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = await chrome.tabs.create({
    url: parsed.href,
    active: false,
    openerTabId: activeTab?.id
  });

  try {
    await restoreActiveTab(activeTab, tab);
    await waitForTabComplete(tab.id, 12000);
    await restoreActiveTab(activeTab, tab);
    await delay(600);
    return await task(tab.id);
  } finally {
    if (tab.id) {
      await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
}

async function restoreActiveTab(activeTab, detailTab) {
  if (!activeTab?.id || !detailTab?.id) return;

  const currentDetailTab = await chrome.tabs.get(detailTab.id).catch(() => null);
  if (currentDetailTab?.active) {
    await chrome.tabs.update(activeTab.id, { active: true }).catch(() => {});
  }
}

async function requestQrFromTab(tabId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "BOSS_CAPTURE_QR_IN_TAB" });
      if (response?.ok) return response.dataUrl || "";
    } catch (error) {
      if (attempt === 0) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
      }
    }

    await delay(500);
  }

  return "";
}

async function requestJobFromTab(tabId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "BOSS_EXTRACT_JOB_IN_TAB" });
      if (response?.ok && response.job) return response.job;
    } catch (error) {
      if (attempt === 0) {
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }).catch(() => {});
      }
    }

    await delay(500);
  }

  throw new Error("网页端职位详情读取失败");
}

function waitForTabComplete(tabId, timeout) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(reject, new Error("职位详情页加载超时")), timeout);

    const finish = (callback, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      callback(value);
    };

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        finish(resolve);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId)
      .then((current) => {
        if (current.status === "complete") finish(resolve);
      })
      .catch((error) => finish(reject, error));
  });
}

async function fetchAsDataUrl(url) {
  const parsed = new URL(url);
  if (!isAllowedImageUrl(parsed)) {
    throw new Error("不支持的图片地址");
  }

  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`图片请求失败：${response.status}`);
  }

  const blob = await response.blob();
  if (blob.type && !blob.type.startsWith("image/")) {
    throw new Error("资源不是图片");
  }
  if (blob.size > 6 * 1024 * 1024) {
    throw new Error("图片过大");
  }

  const mime = blob.type || "image/png";
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return `data:${mime};base64,${btoa(binary)}`;
}

function isAllowedImageUrl(url) {
  if (url.protocol !== "https:") return false;
  return url.hostname === "zhipin.com" ||
    url.hostname.endsWith(".zhipin.com") ||
    url.hostname === "bosszhipin.com" ||
    url.hostname.endsWith(".bosszhipin.com");
}

function isAllowedDetailUrl(url) {
  return url.protocol === "https:" &&
    (url.hostname === "zhipin.com" || url.hostname.endsWith(".zhipin.com")) &&
    /\/job_detail\//.test(url.pathname);
}

function normalizeReleaseVersion(value) {
  return String(value || "").trim().replace(/^v/i, "").match(/\d+(?:\.\d+){0,3}/)?.[0] || "";
}

function compareVersions(a, b) {
  const left = normalizeReleaseVersion(a).split(".").map((part) => Number(part) || 0);
  const right = normalizeReleaseVersion(b).split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
