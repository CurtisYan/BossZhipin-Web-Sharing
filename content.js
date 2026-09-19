(() => {
  if (window.__bossJobShareExtensionLoaded) return;
  window.__bossJobShareExtensionLoaded = true;

  const SALARY_RE = /(([\d０-９\ue031-\ue03a]+(?:\.[\d０-９\ue031-\ue03a]+)?\s*[-‐‑‒–—―−~～－]\s*[\d０-９\ue031-\ue03a]+(?:\.[\d０-９\ue031-\ue03a]+)?\s*(?:K|k|万|千|元\s*[\/／]\s*天|元\s*[\/／]\s*月|元\s*[\/／]\s*时|元\s*[\/／]\s*周|元\s*[\/／]\s*年)(?:\s*[·・]\s*[\d０-９\ue031-\ue03a]+\s*薪)?)|([\d０-９\ue031-\ue03a]+(?:\.[\d０-９\ue031-\ue03a]+)?\s*(?:K|k|万|千|元\s*[\/／]\s*天|元\s*[\/／]\s*月|元\s*[\/／]\s*时|元\s*[\/／]\s*周|元\s*[\/／]\s*年)(?:\s*[·・]\s*[\d０-９\ue031-\ue03a]+\s*薪)?)|面议)/;
  const CITY_RE = /(北京|上海|广州|深圳|杭州|成都|重庆|武汉|西安|南京|苏州|天津|长沙|郑州|青岛|宁波|厦门|合肥|佛山|东莞|珠海|中山|惠州|无锡|常州|济南|福州|昆明|南昌|南宁|贵阳|石家庄|太原|沈阳|大连|长春|哈尔滨|海口|兰州|银川|乌鲁木齐|呼和浩特|拉萨|香港|澳门|台湾)/;
  const PROJECT_URL = "https://github.com/CurtisYan/BossZhipin-Web-Sharing";
  const DEFAULT_QR_TEXT = "扫码查看职位详情";
  const EXTENSION_VERSION = chrome.runtime.getManifest().version;
  const DEBUG_MODE_KEY = "bossShareDebugMode";
  const TEXT_EXPORT_MODE_KEY = "bossShareTextExportEnabled";
  const OUTPUT_MODE_KEY = "bossShareOutputMode";
  const UPDATE_NOTICE_KEY = "bossShareUpdateNotice";
  const OUTPUT_MODE_COPY = "copy";
  const OUTPUT_MODE_DOWNLOAD = "download";
  const UPDATE_NOTICE_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const FLOATING_STYLE_ID = "boss-share-floating-style";
  const FLOATING_BUTTON_IDS = [
    "boss-share-long-image-button",
    "boss-share-text-button",
    "boss-share-debug-button"
  ];
  let debugModeEnabled = false;
  let textExportEnabled = false;
  let debugJobOverride = null;
  let outputMode = OUTPUT_MODE_COPY;
  let floatingUiRepairScheduled = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "BOSS_SET_DEBUG_MODE") {
      setDebugMode(Boolean(message.enabled));
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BOSS_SET_OUTPUT_MODE") {
      setOutputMode(message.mode);
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BOSS_SET_TEXT_EXPORT_MODE") {
      setTextExportMode(Boolean(message.enabled));
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "BOSS_CAPTURE_QR_IN_TAB") {
      findQrDataUrl(findJobDetailRoot())
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "BOSS_EXTRACT_JOB_IN_TAB") {
      extractCurrentJobForBackground()
        .then((job) => sendResponse({ ok: true, job }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type !== "BOSS_GENERATE_SHARE_IMAGE") return false;

    generateShareImage({
      outputMode: message.outputMode,
      copy: typeof message.copy === "boolean" ? message.copy : undefined
    })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        notify(error.message || "生成失败，请刷新页面后重试。", true);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  });

  injectFloatingButton();
  observeFloatingUi();
  loadExtensionSettings();
  scheduleUpdateNotice();

  function injectFloatingButton() {
    const root = document.documentElement;
    if (!root) return;

    ensureFloatingButton("boss-share-long-image-button", "做长图", () => {
      generateShareImage().catch((error) => notify(error.message, true));
    });
    ensureFloatingButton("boss-share-text-button", "复制职位", () => {
      copyCurrentJobText().catch((error) => notify(error.message, true));
    });
    ensureFloatingButton("boss-share-debug-button", "调试字段", () => {
      showDebugPreview().catch((error) => notify(error.message, true));
    });

    if (!document.getElementById(FLOATING_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = FLOATING_STYLE_ID;
      style.textContent = `
      #boss-share-long-image-button,
      #boss-share-text-button,
      #boss-share-debug-button {
        position: fixed;
        z-index: 2147483647;
        right: 22px;
        width: 104px;
        height: 44px;
        border: 0;
        border-radius: 8px;
        color: #fff;
        cursor: pointer;
        font: 700 14px/1 "PingFang SC", "Microsoft YaHei", sans-serif;
        background: #12b8b6;
        box-shadow: 0 12px 26px rgba(18, 184, 182, 0.28);
      }

      #boss-share-long-image-button {
        bottom: 26px;
      }

      #boss-share-text-button,
      #boss-share-debug-button {
        bottom: 78px;
        color: #0d8f8e;
        background: #ffffff;
        border: 1px solid #12b8b6;
        box-shadow: 0 10px 22px rgba(18, 184, 182, 0.14);
      }

      #boss-share-long-image-button:hover {
        background: #0fa8a6;
      }

      #boss-share-text-button:hover,
      #boss-share-debug-button:hover {
        background: #f1ffff;
      }

      .boss-share-long-image-toast {
        position: fixed;
        z-index: 2147483647;
        left: 50%;
        top: 24px;
        max-width: min(420px, calc(100vw - 40px));
        padding: 12px 16px;
        border-radius: 8px;
        color: #1f2a30;
        font: 500 14px/1.5 "PingFang SC", "Microsoft YaHei", sans-serif;
        background: #ffffff;
        box-shadow: 0 14px 36px rgba(30, 45, 50, 0.16);
        transform: translateX(-50%);
      }

      .boss-share-long-image-toast.is-error {
        color: #9c2b2b;
      }

      .boss-share-debug-overlay {
        position: fixed;
        z-index: 2147483647;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(20, 28, 32, 0.28);
      }

      .boss-share-debug-panel {
        width: min(760px, calc(100vw - 48px));
        max-height: min(760px, calc(100vh - 48px));
        overflow: auto;
        border-radius: 8px;
        color: #1f2a30;
        background: #ffffff;
        box-shadow: 0 22px 70px rgba(18, 31, 36, 0.22);
        font: 14px/1.6 "PingFang SC", "Microsoft YaHei", sans-serif;
      }

      .boss-share-debug-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 18px;
        border-bottom: 1px solid #edf1f2;
      }

      .boss-share-debug-head strong {
        font-size: 16px;
      }

      .boss-share-debug-actions {
        display: flex;
        gap: 8px;
      }

      .boss-share-debug-actions button {
        height: 32px;
        padding: 0 12px;
        border: 1px solid #d8e3e5;
        border-radius: 6px;
        color: #1f2a30;
        cursor: pointer;
        background: #fff;
        font: 500 13px/1 "PingFang SC", "Microsoft YaHei", sans-serif;
      }

      .boss-share-debug-body {
        padding: 16px 18px 18px;
      }

      .boss-share-debug-grid {
        display: grid;
        grid-template-columns: 112px 1fr;
        gap: 8px 14px;
      }

      .boss-share-debug-label {
        color: #7a8589;
      }

      .boss-share-debug-value {
        min-width: 0;
        word-break: break-word;
        white-space: pre-wrap;
      }

      .boss-share-debug-pre {
        width: 100%;
        min-height: 320px;
        margin: 14px 0 0;
        padding: 12px;
        border: 1px solid #d8e3e5;
        border-radius: 6px;
        background: #f6f8f8;
        color: #4f5a5f;
        white-space: pre-wrap;
        word-break: break-word;
        resize: vertical;
        font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      `;
      root.appendChild(style);
    }

    syncFloatingButtonLayout();
  }

  function ensureFloatingButton(id, label, onClick) {
    if (document.getElementById(id)) return;

    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", onClick);
    document.documentElement.appendChild(button);
  }

  function observeFloatingUi() {
    const observer = new MutationObserver((mutations) => {
      const removedFloatingUi = mutations.some((mutation) => [...mutation.removedNodes].some((node) => {
        if (!(node instanceof Element)) return false;
        if (node.id === FLOATING_STYLE_ID || FLOATING_BUTTON_IDS.includes(node.id)) return true;
        return FLOATING_BUTTON_IDS.some((id) => node.querySelector?.(`#${id}`)) ||
          Boolean(node.querySelector?.(`#${FLOATING_STYLE_ID}`));
      }));

      if (removedFloatingUi) scheduleFloatingUiRepair();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setInterval(() => {
      if (!document.getElementById(FLOATING_STYLE_ID) || FLOATING_BUTTON_IDS.some((id) => !document.getElementById(id))) {
        scheduleFloatingUiRepair();
      }
    }, 2000);
  }

  function scheduleFloatingUiRepair() {
    if (floatingUiRepairScheduled) return;
    floatingUiRepairScheduled = true;
    window.setTimeout(() => {
      floatingUiRepairScheduled = false;
      injectFloatingButton();
    }, 80);
  }

  function loadExtensionSettings() {
    chrome.storage?.local?.get({
      [DEBUG_MODE_KEY]: false,
      [TEXT_EXPORT_MODE_KEY]: false,
      [OUTPUT_MODE_KEY]: OUTPUT_MODE_COPY
    }, (result) => {
      setDebugMode(Boolean(result?.[DEBUG_MODE_KEY]));
      setTextExportMode(Boolean(result?.[TEXT_EXPORT_MODE_KEY]));
      setOutputMode(result?.[OUTPUT_MODE_KEY]);
    });

    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") return;
      if (changes[DEBUG_MODE_KEY]) {
        setDebugMode(Boolean(changes[DEBUG_MODE_KEY].newValue));
      }
      if (changes[TEXT_EXPORT_MODE_KEY]) {
        setTextExportMode(Boolean(changes[TEXT_EXPORT_MODE_KEY].newValue));
      }
      if (changes[OUTPUT_MODE_KEY]) {
        setOutputMode(changes[OUTPUT_MODE_KEY].newValue);
      }
    });
  }

  function setDebugMode(enabled) {
    debugModeEnabled = enabled;
    syncFloatingButtonLayout();
  }

  function setTextExportMode(enabled) {
    textExportEnabled = enabled;
    syncFloatingButtonLayout();
  }

  function syncFloatingButtonLayout() {
    const textButton = document.querySelector("#boss-share-text-button");
    const debugButton = document.querySelector("#boss-share-debug-button");

    if (textButton) {
      textButton.style.display = textExportEnabled ? "block" : "none";
      textButton.style.bottom = "78px";
    }

    if (debugButton) {
      debugButton.style.display = debugModeEnabled ? "block" : "none";
      debugButton.style.bottom = textExportEnabled ? "130px" : "78px";
    }
  }

  function setOutputMode(mode) {
    outputMode = normalizeOutputMode(mode);
  }

  function resolveOutputMode(options) {
    if (options.outputMode) return normalizeOutputMode(options.outputMode);
    if (typeof options.copy === "boolean") return options.copy ? OUTPUT_MODE_COPY : OUTPUT_MODE_DOWNLOAD;
    return outputMode;
  }

  function normalizeOutputMode(mode) {
    return mode === OUTPUT_MODE_DOWNLOAD ? OUTPUT_MODE_DOWNLOAD : OUTPUT_MODE_COPY;
  }

  async function generateShareImage(options = {}) {
    const mode = resolveOutputMode(options);
    notify("正在读取当前职位...");
    const mobileShareUrl = detailUrlFromMobileSharePage();
    const root = mobileShareUrl ? null : findJobDetailRoot();
    const job = applyDebugOverride(mobileShareUrl ? await extractJobFromDetailPage(mobileShareUrl) : await enrichJobFromDetailPage(extractJob(root), root));

    if (!job.title || !job.description) {
      throw new Error("没有识别到完整职位详情，请先点击左侧某个职位后再试。");
    }

    notify("正在尝试获取微信分享二维码...");
    if (!job.qrDataUrl) {
      job.qrDataUrl = await findQrDataUrl(root || document.body, { fallbackUrl: findDetailPageUrl(job.title, root || document.body) }).catch(() => "");
    }

    notify("正在绘制长图...");
    const blob = await renderJobPoster(job);
    const shouldCopy = mode === OUTPUT_MODE_COPY;
    const copied = shouldCopy ? await copyImageBlob(blob).catch(() => false) : false;

    if (copied) {
      notify(job.qrDataUrl ? "职位长图已复制，可以直接粘贴发送。" : "长图已复制，但未抓到二维码；可先点击“微信扫码分享”弹出二维码后再试。");
      scheduleUpdateNotice();
      return;
    }

    downloadBlob(blob, fileName(job));
    notify(shouldCopy ? "剪贴板写入失败，已改为下载 PNG。" : "职位长图已下载。");
    scheduleUpdateNotice();
  }

  async function copyCurrentJobText() {
    notify("正在读取当前职位...");
    const mobileShareUrl = detailUrlFromMobileSharePage();
    const root = mobileShareUrl ? null : findJobDetailRoot();
    const job = applyDebugOverride(mobileShareUrl ? await extractJobFromDetailPage(mobileShareUrl) : await enrichJobFromDetailPage(extractJob(root), root));

    if (!job.title || !job.description) {
      throw new Error("没有识别到完整职位详情，请先点击左侧某个职位后再试。");
    }

    await copyTextToClipboard(formatJobText(job));
    notify("职位文本已复制，可以直接粘贴使用。");
    scheduleUpdateNotice();
  }

  function formatJobText(job) {
    const lines = [];
    const conditions = [...new Set((job.metaParts || [])
      .map(normalizeMetaPart)
      .filter((part) => part && part !== job.city && part !== job.salary))];

    lines.push(`职位：${job.title}`);
    if (job.company) lines.push(`公司：${job.company}`);
    if (job.salary) lines.push(`薪资：${job.salary}`);
    if (job.city) lines.push(`地点：${job.city}`);
    if (conditions.length) lines.push(`条件：${conditions.join(" / ")}`);
    if (job.recruiter) lines.push(`招聘人：${job.recruiter}`);
    if (job.address) lines.push(`工作地址：${job.address}`);
    lines.push("", "职位详情：", job.description);
    if (job.url) lines.push("", `职位链接：${job.url}`);
    lines.push("", `生成工具：BOSS 职位长图分享`, `项目地址：${PROJECT_URL}`);
    return lines.join("\n");
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Fall back when async extraction consumes user activation.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.documentElement.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("复制失败，请检查浏览器剪贴板权限后重试。");
  }

  function scheduleUpdateNotice() {
    window.setTimeout(() => {
      chrome.runtime.sendMessage({ type: "BOSS_CHECK_UPDATE", force: false })
        .then((response) => maybeShowUpdateNotice(response))
        .catch(() => {});
    }, 900);
  }

  async function maybeShowUpdateNotice(response) {
    if (!response?.ok || !response.updateAvailable) return;

    const stored = await chrome.storage.local.get({ [UPDATE_NOTICE_KEY]: null });
    const previous = stored[UPDATE_NOTICE_KEY];
    const now = Date.now();
    if (previous?.latestVersion === response.latestVersion && now - previous.notifiedAt < UPDATE_NOTICE_INTERVAL_MS) {
      return;
    }

    await chrome.storage.local.set({
      [UPDATE_NOTICE_KEY]: {
        latestVersion: response.latestVersion,
        notifiedAt: now
      }
    });
    notify(`发现新版本 v${response.latestVersion}，可打开插件页查看更新内容。`);
  }

  async function showDebugPreview() {
    const root = findJobDetailRoot();
    const job = applyDebugOverride(await enrichJobFromDetailPage(extractJob(root), root));
    const rootRect = root.getBoundingClientRect();
    const mobileMeta = buildMobileShareMeta(job);
    const payload = {
      version: EXTENSION_VERSION,
      title: job.title,
      company: job.company,
      salary: job.salary,
      mobileMeta: mobileMeta.join("/"),
      rawMetaParts: job.metaParts,
      city: job.city,
      experience: job.experience,
      conditions: job.conditions,
      degree: job.degree,
      isIntern: job.isIntern,
      recruiter: job.recruiter,
      address: job.address,
      description: job.description,
      descriptionLength: job.description.length,
      descriptionHead: job.description.slice(0, 260),
      descriptionTail: job.description.slice(-260),
      detailRoot: {
        tag: root.tagName?.toLowerCase(),
        className: root.className || "",
        rect: {
          left: Math.round(rootRect.left),
          top: Math.round(rootRect.top),
          width: Math.round(rootRect.width),
          height: Math.round(rootRect.height)
        }
      },
      url: job.url
    };

    renderDebugPanel(payload);
  }

  function renderDebugPanel(payload) {
    document.querySelector(".boss-share-debug-overlay")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "boss-share-debug-overlay";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });

    const panel = document.createElement("div");
    panel.className = "boss-share-debug-panel";
    panel.innerHTML = `
      <div class="boss-share-debug-head">
        <strong>调试字段预览 v${escapeHtml(payload.version)}</strong>
        <div class="boss-share-debug-actions">
          <button type="button" data-action="apply">应用修改</button>
          <button type="button" data-action="copy">复制 JSON</button>
          <button type="button" data-action="close">关闭</button>
        </div>
      </div>
      <div class="boss-share-debug-body">
        <div class="boss-share-debug-grid">
          ${debugRow("职位", payload.title)}
          ${debugRow("公司", payload.company)}
          ${debugRow("薪资", payload.salary || "未获取")}
          ${debugRow("手机 meta", payload.mobileMeta || "未获取")}
          ${debugRow("原始 meta", (payload.rawMetaParts || []).join(" / ") || "未获取")}
          ${debugRow("实习判断", String(payload.isIntern))}
          ${debugRow("招聘者", payload.recruiter || "未获取")}
          ${debugRow("地址", payload.address || "未获取")}
          ${debugRow("正文长度", String(payload.descriptionLength))}
          ${debugRow("详情 root", `${payload.detailRoot.tag}.${payload.detailRoot.className || ""}`)}
        </div>
        <textarea class="boss-share-debug-pre" spellcheck="false">${escapeHtml(JSON.stringify(payload, null, 2))}</textarea>
      </div>
    `;

    panel.querySelector("[data-action='close']").addEventListener("click", () => overlay.remove());
    panel.querySelector("[data-action='copy']").addEventListener("click", async () => {
      await navigator.clipboard.writeText(panel.querySelector(".boss-share-debug-pre").value);
      notify("调试字段 JSON 已复制。");
    });
    panel.querySelector("[data-action='apply']").addEventListener("click", () => {
      try {
        const value = panel.querySelector(".boss-share-debug-pre").value;
        debugJobOverride = JSON.parse(value);
        notify("已应用调试字段，下一次做长图会使用修改后的内容。");
      } catch (error) {
        notify(`JSON 格式不正确：${error.message}`, true);
      }
    });

    overlay.appendChild(panel);
    document.documentElement.appendChild(overlay);
  }

  function debugRow(label, value) {
    return `
      <div class="boss-share-debug-label">${escapeHtml(label)}</div>
      <div class="boss-share-debug-value">${escapeHtml(value || "")}</div>
    `;
  }

  function applyDebugOverride(job) {
    if (!debugJobOverride || typeof debugJobOverride !== "object") return job;

    const override = debugJobOverride;
    const next = {
      ...job,
      title: override.title ?? job.title,
      company: override.company ?? job.company,
      salary: override.salary ?? job.salary,
      city: override.city ?? job.city,
      experience: override.experience ?? job.experience,
      conditions: Array.isArray(override.conditions) ? override.conditions : job.conditions,
      degree: override.degree ?? job.degree,
      recruiter: override.recruiter ?? job.recruiter,
      address: override.address ?? job.address,
      description: override.description ?? job.description,
      metaParts: Array.isArray(override.rawMetaParts) ? override.rawMetaParts : Array.isArray(override.metaParts) ? override.metaParts : job.metaParts,
      isIntern: typeof override.isIntern === "boolean" ? override.isIntern : job.isIntern
    };

    if (override.mobileMeta) {
      next.manualMobileMetaParts = String(override.mobileMeta).split("/").map(normalizeMetaPart).filter(Boolean);
    }

    return next;
  }

  async function copyImageBlob(blob) {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type || "image/png"]: blob })
        ]);
        return true;
      } catch {
        // User activation may expire after background detail-page extraction.
      }
    }

    return copyImageBlobViaBackground(blob);
  }

  async function copyImageBlobViaBackground(blob) {
    const dataUrl = await blobToDataUrl(blob);
    const response = await chrome.runtime.sendMessage({ type: "BOSS_COPY_IMAGE_DATA_URL", dataUrl });
    return Boolean(response?.ok);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(blob);
    });
  }

  function findJobDetailRoot() {
    const preferredSelectors = [
      ".job-detail-box",
      ".job-detail-container",
      ".job-detail",
      ".detail-content",
      ".recommend-card",
      ".job-detail-card",
      "[class*='job-detail']",
      "[class*='detail-content']",
      "[class*='detail-card']"
    ];
    const candidates = new Set();

    for (const selector of preferredSelectors) {
      document.querySelectorAll(selector).forEach((node) => candidates.add(node));
    }

    document.querySelectorAll("section, article, main, div").forEach((node) => {
      const text = visibleText(node);
      if (text.includes("职位描述") && text.length > 120) candidates.add(node);
    });

    const scored = [...candidates]
      .filter((node) => isVisible(node))
      .flatMap((node) => [node, ...findBetterDetailChildren(node)])
      .map((node) => ({ node, score: scoreDetailNode(node) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.node || document.body;
  }

  function scoreDetailNode(node) {
    const rect = node.getBoundingClientRect();
    const text = visibleText(node);
    let score = 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const likelyOuterMixedContainer = rect.left < viewportWidth * 0.25 && rect.width > viewportWidth * 0.55 && text.includes("牛牛查公司");

    if (node === document.body || node === document.documentElement) score -= 100;
    if (likelyOuterMixedContainer) score -= 120;
    if (rect.width < 420 || rect.height < 220) score -= 30;
    if (rect.left > viewportWidth * 0.25) score += 46;
    if (rect.left > viewportWidth * 0.35) score += 24;
    if (rect.width > viewportWidth * 0.74) score -= 80;
    if (rect.left < viewportWidth * 0.2 && rect.width > viewportWidth * 0.5) score -= 70;
    if (text.includes("职位描述")) score += 42;
    if (text.includes("微信扫码分享")) score += 22;
    if (text.includes("工作地址")) score += 12;
    if (text.includes("立即沟通")) score += 8;
    if (SALARY_RE.test(text)) score += 14;
    if (text.length > 700) score += 12;
    if (text.length > 8000) score -= 22;
    if (rect.width > window.innerWidth * 0.86) score -= 14;

    return score;
  }

  function findBetterDetailChildren(node) {
    const nodeRect = node.getBoundingClientRect();
    if (nodeRect.width < (window.innerWidth || 0) * 0.55) return [];

    return [...node.querySelectorAll("section, article, div")]
      .filter(isVisible)
      .filter((child) => child !== node)
      .filter((child) => {
        const rect = child.getBoundingClientRect();
        const text = visibleText(child);
        if (!text.includes("职位描述") || text.length < 120) return false;
        if (text.includes("牛牛查公司")) return false;
        if (rect.width < 420 || rect.height < 220) return false;
        if (rect.left <= nodeRect.left + nodeRect.width * 0.28) return false;
        return true;
      });
  }

  function extractJob(root) {
    if (/\/web\/geek\/jobs/.test(location.pathname) && root === document.body) {
      throw new Error("未定位到当前职位详情，请先打开职位或进入独立详情页后重试。");
    }
    const text = normalizeText(nodeText(root));
    const fieldScope = jobFieldScope(root);
    const pageText = normalizeText(nodeText(fieldScope));
    const scriptText = /\/web\/geek\/jobs/.test(location.pathname) ? "" : readPageDataText();
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const topLines = lines.slice(0, 16);
    const header = pickJobHeaderSnapshot(root);
    const title = pickTitle(root, topLines, header);
    const salary = pickSalary(root, topLines, text, pageText, scriptText, title, header);
    const meta = pickMeta(root, topLines, text, pageText, scriptText, title, salary, header);
    const description = pickDescription(root, text);
    const recruiter = pickRecruiter(root, lines, description);
    const company = normalizeCompany(pickCompany(lines, description, title), recruiter) || "BOSS 直聘";
    const address = pickAddress(text);
    completeMetaCity(meta, address);

    return {
      title,
      salary,
      metaParts: meta.parts,
      city: meta.city,
      experience: meta.experience,
      conditions: meta.conditions,
      degree: meta.degree,
      company,
      recruiter,
      address,
      description,
      isIntern: isInternJob(salary, meta.parts, text),
      url: findDetailPageUrl(title, root) || location.href,
      date: formatDate(new Date()),
      dateParts: formatDateParts(new Date())
    };
  }

  async function enrichJobFromDetailPage(job, root) {
    if (isUsableSalary(job.salary) && !isInvalidCompany(job.company)) return job;

    const detailUrl = findDetailPageUrl(job.title, root);
    if (!detailUrl) return job;

    try {
      const response = await fetch(detailUrl, { credentials: "include", cache: "no-store" });
      if (!response.ok) return job;

      const html = await response.text();
      const detailSalary = pickSalaryFromDetailHtml(html, job.title);
      const detailCompany = pickCompanyFromDetailHtml(html);

      return {
        ...job,
        salary: isUsableSalary(job.salary) ? job.salary : detailSalary || job.salary,
        company: isInvalidCompany(job.company) ? detailCompany || companyFromRecruiter(job.recruiter) || job.company : job.company
      };
    } catch {
      return job;
    }
  }

  async function extractCurrentJobForBackground() {
    const root = findJobDetailRoot();
    const job = await enrichJobFromDetailPage(extractJob(root), root);
    job.qrDataUrl = await findQrDataUrl(root).catch(() => "");
    return job;
  }

  async function extractJobFromDetailPage(url) {
    const response = await chrome.runtime.sendMessage({ type: "BOSS_EXTRACT_JOB_FROM_URL", url });
    if (!response?.ok || !response.job) {
      throw new Error(response?.error || "网页端职位详情读取失败。");
    }
    return response.job;
  }

  // A detail body's header may be a sibling. Stop before the ancestor that
  // also contains the results list; scrolling must not change job identity.
  function jobFieldScope(root) {
    if (!/\/web\/geek\/jobs/.test(location.pathname)) return document.body;
    let scope = root;
    const cards = ".job-card-wrapper, .job-card-box, .job-list-box, .job-list";
    if (scope === document.body || scope.querySelector(cards)) return root;
    while (scope.parentElement && scope.parentElement !== document.body) {
      const parent = scope.parentElement;
      if (parent.querySelector(cards)) break;
      scope = parent;
    }
    return scope;
  }

  function isCityMeta(value) {
    const text = normalizeMetaPart(value);
    const city = text.match(CITY_RE)?.[0];
    if (!city || !text.startsWith(city) || /公司|集团|有限|招聘|中心/.test(text)) return false;
    const tail = text.slice(city.length);
    return /^(?:市)?(?:[·・].+)?$/.test(tail);
  }

  function pickJobHeaderSnapshot(root) {
    const rootRect = root?.getBoundingClientRect?.() || { top: Number.POSITIVE_INFINITY, left: 0, right: window.innerWidth || 0 };
    const selectors = [
      ".job-primary",
      ".job-banner",
      ".job-header",
      ".job-info",
      ".job-detail-header",
      ".job-status",
      "[class*='job-primary']",
      "[class*='job-banner']",
      "[class*='job-header']",
      "[class*='job-info']",
      "[class*='job-status']"
    ];
    const scope = jobFieldScope(root);
    const scopes = new Set([scope]);

    for (const selector of selectors) {
      scope.querySelectorAll(selector).forEach((node) => scopes.add(node));
    }

    scope.querySelectorAll("section, article, header, main, div").forEach((node) => {
      const text = cleanInlineText(node.innerText || node.textContent || "");
      if (text.length >= 16 && text.length <= 900 && SALARY_RE.test(normalizeSalaryText(text))) {
        scopes.add(node);
      }
    });

    const candidates = [...scopes]
      .filter(isVisible)
      .map((node) => buildHeaderCandidate(node, rootRect))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return candidates[0] || { title: "", salary: "", metaParts: [] };
  }

  function buildHeaderCandidate(node, rootRect) {
    const rect = node.getBoundingClientRect();
    const text = normalizeText(nodeText(node));
    const inlineText = cleanInlineText(text);
    const salary = cleanSalary(inlineText.match(SALARY_RE)?.[0] || "");
    const title = pickHeaderTitle(node, salary);
    const metaParts = pickHeaderMetaParts(node, title, salary);
    if (!salary || !title || !looksLikeTitle(title) || looksLikeRecruiterTitle(title)) return null;

    const style = getComputedStyle(node);
    let score = 80;
    if (rect.top < Math.max(rootRect.top, window.innerHeight || 0)) score += 36;
    if (rect.bottom <= rootRect.top + 90) score += 46;
    if (rect.top <= 80) score += 24;
    if (/fixed|sticky/.test(style.position)) score += 28;
    if (/立即沟通|感兴趣|完善在线简历|下载App/.test(inlineText)) score += 26;
    if (metaParts.some((part) => isCityMeta(part))) score += 26;
    if (inlineText.includes("职位描述")) score -= 95;
    if (/工作地址|公司介绍|工商信息|微信扫码分享/.test(inlineText)) score -= 34;
    if (inlineText.length > 520) score -= Math.min(90, (inlineText.length - 520) / 5);
    if (rect.width > (window.innerWidth || 0) * 0.92 && rect.height > 520) score -= 35;

    return { node, title: removeSalary(title), salary, metaParts, score };
  }

  function pickHeaderTitle(scope, salary) {
    const selectors = [
      "h1",
      "h2",
      ".job-title",
      ".job-name",
      "[class*='job-name']",
      "[class*='job-title']",
      ".name"
    ];

    for (const selector of selectors) {
      const node = scope.querySelector(selector);
      const text = removeSalary(cleanInlineText(node?.innerText || node?.textContent || ""));
      if (looksLikeTitle(text) && !looksLikeRecruiterTitle(text)) return text;
    }

    const candidates = [...scope.querySelectorAll("h1, h2, h3, span, div, p")]
      .filter(isVisible)
      .map((node) => {
        const text = removeSalary(cleanInlineText(node.innerText || node.textContent || ""));
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          text,
          rect,
          score: (parseFloat(style.fontSize) || 0) * 2 + (parseInt(style.fontWeight, 10) || 400) / 100
        };
      })
      .filter((item) => looksLikeTitle(item.text) && !looksLikeRecruiterTitle(item.text))
      .filter((item) => item.text !== salary && item.rect.height <= 90)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.text || "";
  }

  function pickHeaderMetaParts(scope, title, salary) {
    const titleNode = findTitleNode(scope, title);
    const titleRect = titleNode?.getBoundingClientRect?.() || null;
    const raw = [];

    [...scope.querySelectorAll("span, p, li, div")]
      .filter(isVisible)
      .forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (titleRect) {
          const belowTitle = rect.top >= titleRect.bottom - 14 && rect.top <= titleRect.bottom + 96;
          const sameBand = Math.abs(centerY(rect) - (titleRect.bottom + 24)) < 70;
          if (!belowTitle && !sameBand) return;
        }
        if (rect.height > 82 || rect.width > Math.max(520, (window.innerWidth || 0) * 0.42)) return;

        const text = cleanInlineText(node.innerText || node.textContent || "");
        if (!text || text === title || text === salary || SALARY_RE.test(normalizeSalaryText(text))) return;
        if (/立即沟通|感兴趣|完善在线简历|新增附件简历|交通补助|生日福利|节日福利|免费工装|团建聚餐|餐补/.test(text)) return;

        splitMetaText(text).forEach((part) => {
          if (isLikelyMetaText(part, title, salary)) raw.push({ text: normalizeMetaPart(part), rect });
        });
      });

    const unique = [];
    for (const item of raw.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
      if (!unique.includes(item.text)) unique.push(item.text);
    }

    const cityIndex = unique.findIndex((part) => isCityMeta(part));
    return cityIndex > 0 ? unique.slice(cityIndex) : unique;
  }

  function looksLikeRecruiterTitle(text) {
    const value = cleanInlineText(text);
    return /^[\u4e00-\u9fa5]{1,4}(先生|女士)\s*(在线|刚刚活跃|今日活跃)?$/.test(value) ||
      /^(先生|女士|在线|刚刚活跃|今日活跃)$/.test(value);
  }

  function pickTitle(root, topLines, header = null) {
    if (header?.title && looksLikeTitle(header.title) && !looksLikeRecruiterTitle(header.title)) {
      return removeSalary(header.title);
    }

    const titleSelectors = [
      "h1",
      "h2",
      ".job-title",
      ".job-name",
      "[class*='job-name']",
      "[class*='job-title']",
      ".name"
    ];

    for (const selector of titleSelectors) {
      const node = root.querySelector(selector);
      const text = cleanInlineText(node?.innerText || "");
      if (looksLikeTitle(text) && !looksLikeRecruiterTitle(text)) return removeSalary(text);
    }

    const visualCandidates = [...root.querySelectorAll("h1, h2, h3, span, div")]
      .filter(isVisible)
      .map((node) => {
        const text = cleanInlineText(node.innerText || node.textContent || "");
        const style = getComputedStyle(node);
        return { text, size: parseFloat(style.fontSize), weight: parseInt(style.fontWeight, 10) || 400 };
      })
      .filter((item) => looksLikeTitle(item.text) && !looksLikeRecruiterTitle(item.text))
      .sort((a, b) => (b.size * 2 + b.weight / 100) - (a.size * 2 + a.weight / 100));

    if (visualCandidates[0]) return removeSalary(visualCandidates[0].text);

    return removeSalary(topLines.find((line) => looksLikeTitle(line) && !looksLikeRecruiterTitle(line)) || "");
  }

  function looksLikeTitle(text) {
    if (!text) return false;
    if (text.length > 36) return false;
    if (/职位描述|岗位职责|任职要求|工作地址|微信|收藏|立即沟通|举报/.test(text)) return false;
    return /[\u4e00-\u9fa5A-Za-z]/.test(text);
  }

  function pickSalary(root, topLines, text, pageText, scriptText, title, header = null) {
    if (header?.salary) return header.salary;

    const fixedHeaderSalary = pickSalaryFromFixedHeader(root, title);
    if (fixedHeaderSalary) return fixedHeaderSalary;

    const visualHeaderSalary = pickSalaryFromVisualHeader(root);
    if (visualHeaderSalary) return visualHeaderSalary;

    const documentHeaderSalary = pickSalaryFromDocumentHeader(root, title);
    if (documentHeaderSalary) return documentHeaderSalary;

    const nearbyHeaderSalary = pickLooseSalaryNearTitle(root, title);
    if (nearbyHeaderSalary) return nearbyHeaderSalary;

    const candidates = [];
    const addCandidate = (value, source, score) => {
      const salary = cleanSalary(value);
      if (!salary) return;
      let finalScore = score;
      if (title && source.includes(title)) finalScore += 35;
      if (source.includes("职位描述")) finalScore += 10;
      candidates.push({ salary, score: finalScore });
    };

    [...root.querySelectorAll("span, div, p")]
      .filter(isVisible)
      .forEach((node) => {
        const line = cleanInlineText(node.innerText || node.textContent || "");
        const match = line.match(SALARY_RE);
        if (line.length < 80 && match) addCandidate(match[0], line, 35);
      });

    for (const node of (/\/web\/geek\/jobs/.test(location.pathname) ? [] : findCurrentJobNodes(title))) {
      const nodeText = cleanInlineText(node.innerText || node.textContent || "");
      for (const match of nodeText.matchAll(new RegExp(SALARY_RE.source, "g"))) {
        addCandidate(match[0], nodeText, 48);
      }
    }

    for (const line of `${topLines.join("\n")}\n${pageText.slice(0, 6000)}\n${scriptText}`.split("\n")) {
      for (const match of line.matchAll(new RegExp(SALARY_RE.source, "g"))) {
        addCandidate(match[0], line, scriptText.includes(line) ? 14 : 12);
      }
    }

    const bestBySalary = new Map();
    for (const item of candidates) {
      const existing = bestBySalary.get(item.salary);
      if (!existing || item.score > existing.score) bestBySalary.set(item.salary, item);
    }

    const unique = [...bestBySalary.values()];
    unique.sort((a, b) => b.score - a.score);
    return unique[0]?.salary || cleanSalary((topLines.join(" ") || text).match(SALARY_RE)?.[0] || "");
  }

  function pickSalaryFromVisualHeader(root) {
    const rootRect = root.getBoundingClientRect();
    const candidates = [...root.querySelectorAll("span, div, p, b, strong")]
      .filter(isVisible)
      .map((node) => {
        const text = cleanInlineText(node.innerText || node.textContent || "");
        const match = text.match(SALARY_RE);
        if (!match) return null;

        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          node,
          text,
          salary: cleanSalary(match[0]),
          rect,
          size: parseFloat(style.fontSize) || 0,
          weight: parseInt(style.fontWeight, 10) || 400,
          color: style.color || ""
        };
      })
      .filter(Boolean)
      .filter(({ text, rect }) => {
        if (text.length > 90) return false;
        if (rect.top < rootRect.top - 10 || rect.top > rootRect.top + 150) return false;
        if (rect.left < rootRect.left || rect.left > rootRect.right) return false;
        if (rect.height > 90) return false;
        return true;
      })
      .map((item) => ({ ...item, score: scoreVisualSalaryCandidate(item, rootRect) }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.salary || "";
  }

  function pickSalaryFromDocumentHeader(root, title) {
    const rootRect = root.getBoundingClientRect();
    const titleNode = findTitleNode(root, title) || findTitleNode(jobFieldScope(root), title);
    const titleRect = titleNode?.getBoundingClientRect();
    const candidates = collectVisibleSalaryCandidates(jobFieldScope(root))
      .filter(({ text, rect }) => {
        if (text.length > 120) return false;
        if (rect.height > 120) return false;
        if (rect.top < 0 || rect.top > window.innerHeight) return false;
        if (rootRect.width > 0) {
          const nearRootTop = rect.top >= rootRect.top - 40 && rect.top <= rootRect.top + 190;
          const insideRootX = rect.left >= rootRect.left - 24 && rect.left <= rootRect.right + 24;
          if (nearRootTop && insideRootX) return true;
        }
        if (!titleRect) return false;
        return Math.abs(centerY(rect) - centerY(titleRect)) < 78 && rect.left > titleRect.left + 80;
      })
      .map((item) => ({ ...item, score: scoreDocumentSalaryCandidate(item, rootRect, titleRect, title) }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.salary || "";
  }

  function collectVisibleSalaryCandidates(scope) {
    const candidates = [];
    const nodes = [...scope.querySelectorAll("span, div, p, b, strong, em, i")]
      .filter(isVisible)
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.width < Math.max(700, window.innerWidth * 0.55);
      });

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const text = cleanInlineText(node.innerText || node.textContent || "");
      addSalaryMatches(candidates, node, text, rect, style);

      const next = nodes[index + 1];
      if (next) {
        const nextText = cleanInlineText(next.innerText || next.textContent || "");
        const nextRect = next.getBoundingClientRect();
        if (nextRect.top - rect.top < 8 && nextRect.left >= rect.left) {
          addSalaryMatches(candidates, node, `${text}${nextText}`, rect, style);
        }
      }
    }

    return candidates;
  }

  function addSalaryMatches(candidates, node, text, rect, style) {
    if (!text || text.length > 140) return;
    const normalized = normalizeSalaryText(text);
    for (const match of normalized.matchAll(new RegExp(SALARY_RE.source, "g"))) {
      candidates.push({
        node,
        text: normalized,
        salary: cleanSalary(match[0]),
        rect,
        size: parseFloat(style.fontSize) || 0,
        weight: parseInt(style.fontWeight, 10) || 400,
        color: style.color || ""
      });
    }
  }

  function scoreDocumentSalaryCandidate(item, rootRect, titleRect, title) {
    let score = 50;
    score += item.size * 1.8;
    score += item.weight / 22;
    if (isRedLike(item.color)) score += 60;
    if (item.text === item.salary) score += 18;
    if (title && item.text.includes(title)) score += 16;
    if (rootRect.width > 0) {
      if (item.rect.top >= rootRect.top - 20 && item.rect.top <= rootRect.top + 145) score += 50;
      if (item.rect.left >= rootRect.left && item.rect.left <= rootRect.right) score += 30;
    }
    if (titleRect) {
      score -= Math.abs(centerY(item.rect) - centerY(titleRect)) * 0.75;
      if (item.rect.left > titleRect.right - 10) score += 35;
    }
    score -= Math.max(0, item.text.length - 26);
    return score;
  }

  function pickLooseSalaryNearTitle(root, title) {
    const titleNode = findTitleNode(root, title) || findTitleNode(jobFieldScope(root), title);
    const titleRect = titleNode?.getBoundingClientRect();
    if (!titleRect) return "";

    const nearbyText = [...jobFieldScope(root).querySelectorAll("span, div, p, b, strong, em, i")]
      .filter(isVisible)
      .map((node) => ({ node, text: normalizeSalaryText(node.innerText || node.textContent || ""), rect: node.getBoundingClientRect() }))
      .filter(({ text, rect }) => {
        if (!text || text.length > 80) return false;
        const sameRow = Math.abs(centerY(rect) - centerY(titleRect)) < 90;
        const rightSide = rect.left > titleRect.left + 80;
        return sameRow && rightSide;
      })
      .sort((a, b) => a.rect.left - b.rect.left)
      .map((item) => item.text)
      .join("");

    const looseMatch = nearbyText.match(/([\d]+(?:\.\d+)?\s*[-‐‑‒–—―−~～－]\s*[\d]+(?:\.\d+)?\s*(?:K|k|万|千|元\s*[\/／]\s*天|元\s*[\/／]\s*月|元\s*[\/／]\s*时|元\s*[\/／]\s*周|元\s*[\/／]\s*年)(?:\s*[·・]\s*[\d]+\s*薪)?)/);
    return looseMatch ? cleanSalary(looseMatch[1]) : "";
  }

  function pickSalaryFromFixedHeader(root, title) {
    const rootRect = root.getBoundingClientRect();
    const titleNode = findTitleNode(root, title);
    const titleRect = titleNode?.getBoundingClientRect();
    const headerBottom = rootRect.top + Math.min(180, rootRect.height * 0.22);
    const salaryNodes = [...root.querySelectorAll("span, div, p, b, strong")]
      .filter(isVisible)
      .map((node) => {
        const text = cleanInlineText(node.innerText || node.textContent || "");
        const match = text.match(SALARY_RE);
        return match ? { node, text, salary: cleanSalary(match[0]), rect: node.getBoundingClientRect() } : null;
      })
      .filter(Boolean)
      .filter(({ text, rect }) => {
        if (text.length > 120) return false;
        if (rect.height > 120) return false;
        if (rect.top < rootRect.top - 8 || rect.top > headerBottom) return false;
        if (!titleRect) return true;
        const sameRow = Math.abs(centerY(rect) - centerY(titleRect)) < 64;
        const rightOfTitle = rect.left >= titleRect.left + 12;
        const combinedTitleRow = text.includes(title) && SALARY_RE.test(text);
        return combinedTitleRow || (sameRow && rightOfTitle);
      })
      .map((item) => ({ ...item, score: scoreHeaderSalaryCandidate(item, titleRect, title) }))
      .sort((a, b) => b.score - a.score);

    return salaryNodes[0]?.salary || "";
  }

  function findTitleNode(root, title) {
    if (!title) return null;

    return [...root.querySelectorAll("h1, h2, h3, span, div")]
      .filter(isVisible)
      .map((node) => {
        const text = cleanInlineText(node.innerText || node.textContent || "");
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          node,
          text,
          rect,
          score: (text === title ? 100 : text.includes(title) ? 60 : 0) + parseFloat(style.fontSize) + (parseInt(style.fontWeight, 10) || 400) / 100
        };
      })
      .filter((item) => item.score >= 60 && item.text.length <= Math.max(36, title.length + 12))
      .sort((a, b) => b.score - a.score)[0]?.node || null;
  }

  function scoreHeaderSalaryCandidate(item, titleRect, title) {
    let score = 120;
    const style = getComputedStyle(item.node);
    const color = style.color || "";

    if (title && item.text.includes(title)) score += 28;
    if (titleRect) {
      score -= Math.abs(centerY(item.rect) - centerY(titleRect)) * 0.9;
      if (item.rect.left > titleRect.right - 12) score += 32;
    }

    score -= Math.max(0, item.text.length - 28);
    if (/rgb\((24[0-9]|25[0-5]|2[0-3][0-9]),\s*(6[0-9]|7[0-9]|8[0-9]|9[0-9]),/.test(color)) score += 10;
    return score;
  }

  function scoreVisualSalaryCandidate(item, rootRect) {
    let score = 80;
    score += item.size * 2;
    score += item.weight / 20;
    score -= Math.max(0, item.rect.top - rootRect.top) * 0.7;
    if (item.rect.left > rootRect.left + 150) score += 20;
    if (isRedLike(item.color)) score += 45;
    if (item.text === item.salary) score += 18;
    score -= Math.max(0, item.text.length - 24);
    return score;
  }

  function pickMeta(root, topLines, text, pageText, scriptText, title, salary, header = null) {
    if (Array.isArray(header?.metaParts) && header.metaParts.length) {
      return metaFromParts(header.metaParts);
    }

    const fixedParts = pickMetaFromFixedHeader(root, title, salary);
    if (fixedParts.length) {
      return metaFromParts(fixedParts);
    }

    const metaText = topLines.join(" ");
    const source = `${metaText} ${text.slice(0, 800)} ${pageText.slice(0, 2500)} ${scriptText}`.replace(salary, "");
    const city = source.match(CITY_RE)?.[0] || "";
    const conditionMatches = [];
    if (/在校/.test(source)) conditionMatches.push("在校");
    if (/应届/.test(source)) conditionMatches.push("应届");
    if (/实习/.test(source)) conditionMatches.push("实习");
    const experience = source.match(/(\d+\s*[-–]\s*\d+年|\d+年以上|经验不限|不限)/)?.[0] || "";
    const degree = source.match(/(博士|硕士|本科|大专|中专\/中技|高中|学历不限)/)?.[0] || "";

    const compactMetaNode = [...root.querySelectorAll("p, div, span")]
      .filter(isVisible)
      .map((node) => cleanInlineText(node.innerText || node.textContent || ""))
      .find((line) => line.length < 80 && line.includes(city) && (line.includes(experience) || line.includes(degree) || conditionMatches.some((item) => line.includes(item))));

    if (compactMetaNode) {
      const compactConditions = [];
      if (/在校/.test(compactMetaNode)) compactConditions.push("在校");
      if (/应届/.test(compactMetaNode)) compactConditions.push("应届");
      if (/实习/.test(compactMetaNode)) compactConditions.push("实习");

      return {
        city: compactMetaNode.match(CITY_RE)?.[0] || city,
        experience: compactMetaNode.match(/(\d+\s*[-–]\s*\d+年|\d+年以上|经验不限|不限)/)?.[0] || experience,
        conditions: compactConditions.length ? compactConditions : conditionMatches,
        degree: compactMetaNode.match(/(博士|硕士|本科|大专|中专\/中技|高中|学历不限)/)?.[0] || degree,
        parts: [compactMetaNode.match(CITY_RE)?.[0] || city, compactMetaNode.match(/(\d+\s*[-–]\s*\d+年|\d+年以上|经验不限|不限)/)?.[0] || experience, ...(compactConditions.length ? compactConditions : conditionMatches), compactMetaNode.match(/(博士|硕士|本科|大专|中专\/中技|高中|学历不限)/)?.[0] || degree].filter(Boolean)
      };
    }

    return { city, experience, conditions: conditionMatches, degree, parts: [city, experience, ...conditionMatches, degree].filter(Boolean) };
  }

  function pickMetaFromFixedHeader(root, title, salary) {
    const rootRect = root.getBoundingClientRect();
    const titleNode = findTitleNode(root, title);
    const titleRect = titleNode?.getBoundingClientRect();
    if (!titleRect) return [];

    const descriptionTop = findMarkerTop(root, /^职位描述$/) || rootRect.top + Math.min(260, rootRect.height * 0.3);
    const rawItems = [];

    [...root.querySelectorAll("span, p, li, div")]
      .filter(isVisible)
      .forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.top < titleRect.bottom - 8 || rect.top > descriptionTop - 4) return;
        if (rect.left < rootRect.left - 4 || rect.left > rootRect.right - 120) return;
        if (rect.width > rootRect.width * 0.72 || rect.height > 80) return;

        const text = cleanInlineText(node.innerText || node.textContent || "");
        if (!text || text.length > 80 || !isLikelyMetaText(text, title, salary)) return;

        for (const part of splitMetaText(text)) {
          if (isLikelyMetaText(part, title, salary)) rawItems.push({ text: normalizeMetaPart(part), rect });
        }
      });

    const unique = [];
    for (const item of rawItems.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
      if (unique.includes(item.text)) continue;
      unique.push(item.text);
    }

    const cityIndex = unique.findIndex((part) => isCityMeta(part));
    return cityIndex > 0 ? unique.slice(cityIndex) : unique;
  }

  function metaFromParts(parts) {
    const normalized = parts.map(normalizeMetaPart).filter((part) => isLikelyMetaText(part, "", ""));
    const city = normalized.find((part) => isCityMeta(part)) || "";
    const degree = findDegree(normalized);
    const experience = normalized.find((part) => /(\d+\s*[-–]\s*\d+年|\d+年以上|经验不限|\d+天\/周|\d+个月|\d+年|不限)/.test(part) && part !== degree) || "";
    const conditions = normalized.filter((part) => /^(在校|应届|实习)$/.test(part));

    return { city, experience, conditions, degree, parts: normalized };
  }

  function pickDescription(root, text) {
    const descriptionSelectors = [
      ".job-sec-text",
      ".job-description",
      "[class*='job-sec-text']",
      "[class*='description']",
      "[class*='job-content']"
    ];

    for (const selector of descriptionSelectors) {
      const node = root.querySelector(selector);
      // A dedicated description node contains authored text, including short notices.
      const value = normalizeDescription(node?.innerText || "");
      if (value.length > 60) return value;
    }

    const segment = between(text, "职位描述", [
      "微信扫码分享",
      "举报",
      "赵先生",
      "刚刚活跃",
      "今日活跃",
      "去App",
      "与BOSS随时沟通",
      "女士",
      "先生",
      "工作地址",
      "公司介绍",
      "工商信息",
      "查看地图",
      "查看更多信息"
    ]);

    return trimDescriptionTail(normalizeDescription(segment || text));
  }

  function pickCompany(lines, description, title) {
    const recruiterLine = lines
      .map(cleanInlineText)
      .find((line) => /[·・]/.test(line) && line.length <= 40 && !line.includes(title) && !hasPrivateUseText(line));
    if (recruiterLine) return cleanInlineText(recruiterLine.split(/[·・]/)[0]);

    const filtered = lines.filter((line) => line && !description.includes(line));

    const companyLine = filtered.find((line) => {
      const value = cleanInlineText(line);
      if (!value || value.includes(title) || SALARY_RE.test(value)) return false;
      if (hasPrivateUseText(value)) return false;
      if (/职位描述|岗位职责|任职要求|工作地址|微信|收藏|立即沟通|举报|正在招聘/.test(value)) return false;
      if (/金融科技方向/.test(value)) return false;
      return /公司|科技|信息|网络|电子|贸易|汽车|配件|有限公司|股份|工作室|集团|中心/.test(value) && value.length <= 34;
    });

    return cleanInlineText(companyLine || "");
  }

  function normalizeCompany(company, recruiter) {
    if (!isInvalidCompany(company)) return cleanInlineText(company);
    return companyFromRecruiter(recruiter);
  }

  function companyFromRecruiter(recruiter) {
    const value = cleanInlineText(recruiter);
    if (!value || !/[·・]/.test(value)) return "";
    const company = cleanInlineText(value.split(/[·・]/)[0]);
    return isInvalidCompany(company) ? "" : company;
  }

  function isInvalidCompany(company) {
    const value = cleanInlineText(company);
    if (!value) return true;
    if (hasPrivateUseText(value)) return true;
    if (SALARY_RE.test(normalizeSalaryText(value))) return true;
    if (/^(面议|BOSS 直聘)$/.test(value)) return true;
    return false;
  }

  function cleanRecruiterName(value) {
    const name = cleanInlineText(value)
      .replace(/(?:刚刚活跃|今日活跃|近期活跃|在线|离线|\d+分钟前活跃|\d+小时前活跃).*$/, "")
      .replace(/\s+V$/, "").trim();
    if (!name || /[·・]|公司|经理|人事|招聘|主管|总监|负责人|^HR$|BOSS|职位|工作地址/.test(name)) return "";
    return /^(?:[\u4e00-\u9fa5]{2,6}|[\u4e00-\u9fa5]{1,4}(?:先生|女士)|[A-Za-z][A-Za-z .'-]{1,30})$/.test(name) ? name : "";
  }

  function pickRecruiter(root, lines, description = "") {
    // Prefer the name inside the recruiter card, never a page-wide .name.
    for (const selector of [".boss-info .name", ".boss-info h2", ".job-boss-info .name", ".job-boss-info h2", ".recruiter-info .name", ".boss-name"]) {
      for (const node of root.querySelectorAll(selector)) {
        if (!isVisible(node)) continue;
        const name = cleanRecruiterName(nodeText(node));
        if (name) return name;
      }
    }
    // Some layouts split the name, activity and company/job title into lines.
    const outsideDescription = lines.filter((line) => !description.includes(line));
    for (let i = 0; i < outsideDescription.length; i += 1) {
      if (!/[·・]\s*(?:经理|HR|人事|招聘|主管|总监|负责人)/i.test(outsideDescription.slice(i, i + 2).join(" "))) continue;
      for (let j = i - 1; j >= Math.max(0, i - 3); j -= 1) {
        const name = cleanRecruiterName(outsideDescription[j]);
        if (name) return name;
      }
    }
    return cleanRecruiterName(outsideDescription.find((line) => /^[\u4e00-\u9fa5]{1,4}(先生|女士)(?:\s|$)/.test(line)) || "");
  }

  function completeMetaCity(meta, address) {
    if (meta.city) return meta;
    // Only use the current job's dedicated address; never search page text.
    const city = cleanInlineText(address).match(CITY_RE);
    if (!city || city.index !== 0) return meta;
    meta.city = city[0];
    meta.parts = [meta.city, ...meta.parts.filter((part) => part !== meta.city)];
    return meta;
  }

  function pickAddress(text) {
    const segment = between(text, "工作地址", ["查看地图", "查看更多信息", "公司介绍", "工商信息"]);
    return normalizeDescription(segment).split("\n").find((line) => line.length > 4) || "";
  }

  async function findQrDataUrl(root, options = {}) {
    const before = collectVisibleQrSources();
    const shareNode = findShareNode(root);
    const shareRect = shareNode?.getBoundingClientRect?.() || null;

    if (shareNode) {
      revealShareNode(shareNode);
      await delay(450);

      const hoverResult = await resolveQrDataUrl(before, shareRect);
      if (hoverResult) return hoverResult;

      revealShareNode(shareNode, { click: true });
      await delay(900);
    }

    const localResult = await resolveQrDataUrl(before, shareRect);
    if (shareRect && localResult) return localResult;

    if (options.fallbackUrl && !sameUrl(options.fallbackUrl, location.href)) {
      return captureQrFromDetailPage(options.fallbackUrl);
    }

    return "";
  }

  async function captureQrFromDetailPage(url) {
    const response = await chrome.runtime.sendMessage({ type: "BOSS_CAPTURE_QR_FROM_URL", url });
    return response?.ok ? response.dataUrl || "" : "";
  }

  function collectVisibleQrSources() {
    const sources = new Set([...document.images]
      .filter(isVisible)
      .map((image) => image.currentSrc || image.src)
      .filter(Boolean));

    document.querySelectorAll("div, span, i").forEach((node) => {
      if (!isVisible(node)) return;
      const source = backgroundImageSource(node);
      if (source) sources.add(source);
    });

    return sources;
  }

  async function resolveQrDataUrl(before, shareRect) {
    for (const candidate of findQrCandidates(before, shareRect)) {
      try {
        const dataUrl = await qrCandidateToDataUrl(candidate);
        if (dataUrl) return dataUrl;
      } catch {
        // Try the next candidate; some canvases can be tainted by cross-origin images.
      }
    }

    return "";
  }

  async function qrCandidateToDataUrl(candidate) {
    if (candidate.kind === "canvas") {
      return candidate.node.toDataURL("image/png");
    }

    if (candidate.kind === "svg") {
      const svg = new XMLSerializer().serializeToString(candidate.node);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    const source = candidate.source || candidate.node.currentSrc || candidate.node.src || "";
    if (!source) return "";
    if (source.startsWith("data:")) return source;

    const response = await chrome.runtime.sendMessage({ type: "BOSS_FETCH_AS_DATA_URL", url: new URL(source, location.href).href });
    return response?.ok ? response.dataUrl : "";
  }

  function findShareNode(root) {
    const nodes = [...new Set([
      ...root.querySelectorAll("a, button, span, div"),
      ...document.querySelectorAll("a, button, span, div")
    ])]
      .filter(isVisible)
      .filter((node) => cleanInlineText(node.innerText || node.textContent || "").includes("微信扫码分享"));
    return nodes.sort((a, b) => area(a) - area(b))[0] || null;
  }

  function revealShareNode(node, options = {}) {
    const actionable = node.closest("a, button, [role='button']") || node;
    const chain = [];
    let current = actionable;
    while (current && current !== document.body) {
      chain.push(current);
      current = current.parentElement;
    }

    for (const target of chain) {
      const rect = target.getBoundingClientRect();
      const clientX = rect.left + Math.min(18, Math.max(1, rect.width / 2));
      const clientY = rect.top + Math.min(18, Math.max(1, rect.height / 2));

      if (typeof PointerEvent !== "undefined") {
        ["pointerenter", "pointerover", "pointermove"].forEach((type) => {
          target.dispatchEvent(new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            pointerType: "mouse",
            clientX,
            clientY
          }));
        });
      }

      ["mouseenter", "mouseover", "mousemove"].forEach((type) => {
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY
        }));
      });
    }

    if (!options.click) return;

    const blockJavascriptHref = (event) => {
      if (event.target?.closest?.("a[href^='javascript:'], a[href^='JavaScript:']")) {
        event.preventDefault();
      }
    };

    const rect = actionable.getBoundingClientRect();
    document.addEventListener("click", blockJavascriptHref, true);
    try {
      ["mousedown", "mouseup", "click"].forEach((type) => {
        actionable.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + Math.min(18, rect.width / 2),
          clientY: rect.top + Math.min(18, rect.height / 2)
        }));
      });
    } finally {
      window.setTimeout(() => document.removeEventListener("click", blockJavascriptHref, true), 0);
    }
  }

  function findQrCandidates(before, shareRect) {
    const imageCandidates = [...document.images]
      .filter(isVisible)
      .filter((image) => {
        const rect = image.getBoundingClientRect();
        return isQrSized(rect);
      })
      .map((node) => ({ kind: "image", node, score: qrScore(node, before, shareRect) }));

    const canvasCandidates = [...document.querySelectorAll("canvas")]
      .filter(isVisible)
      .filter((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return isQrSized(rect);
      })
      .map((node) => ({ kind: "canvas", node, score: qrScore(node, before, shareRect) + 8 }));

    const svgCandidates = [...document.querySelectorAll("svg")]
      .filter(isVisible)
      .filter((svg) => {
        const rect = svg.getBoundingClientRect();
        return isQrSized(rect);
      })
      .map((node) => ({ kind: "svg", node, score: qrScore(node, before, shareRect) + 4 }));

    const backgroundCandidates = [...document.querySelectorAll("div, span, i")]
      .filter(isVisible)
      .map((node) => {
        const source = backgroundImageSource(node);
        return source ? { node, source } : null;
      })
      .filter(Boolean)
      .filter(({ node }) => {
        const rect = node.getBoundingClientRect();
        return isQrSized(rect);
      })
      .map(({ node, source }) => ({ kind: "background", node, source, score: qrScore(node, before, shareRect, source) + 6 }));

    return [...imageCandidates, ...canvasCandidates, ...svgCandidates, ...backgroundCandidates]
      .filter((candidate) => candidate.score >= 150)
      .sort((a, b) => b.score - a.score);
  }

  function isQrSized(rect) {
    const width = rect.width || 0;
    const height = rect.height || 0;
    const ratio = width / height;
    return width >= 110 && height >= 110 && width <= 540 && height <= 540 && ratio >= 0.72 && ratio <= 1.28;
  }

  function backgroundImageSource(node) {
    const match = getComputedStyle(node).backgroundImage.match(/url\(["']?(.+?)["']?\)/);
    return match?.[1] || "";
  }

  function qrScore(node, before, shareRect, source = "") {
    const rect = node.getBoundingClientRect();
    const resolvedSource = source || node.currentSrc || node.src || "";
    const text = cleanInlineText(node.closest("div, section, aside, article")?.innerText || node.getAttribute?.("alt") || "");
    let score = Math.min(rect.width, rect.height);
    const squarePenalty = Math.abs(rect.width - rect.height);

    score -= squarePenalty * 0.45;
    if (before.has(resolvedSource)) score -= 45;
    if (/qr|qrcode|weixin|wechat|mini|scene|share|code|boss/i.test(resolvedSource)) score += 55;
    if (/扫码|微信|分享|二维码/.test(text)) score += 75;

    if (shareRect) {
      const horizontalGap = Math.abs((rect.left + rect.width / 2) - (shareRect.left + shareRect.width / 2));
      const belowShare = rect.top >= shareRect.top - 40;
      if (belowShare && horizontalGap < 280) score += 155;
      if (rect.top >= shareRect.bottom - 12 && rect.top <= shareRect.bottom + 360) score += 55;
    } else if (rect.top < window.innerHeight && rect.left > window.innerWidth * 0.45) {
      score += 80;
    }

    if (getComputedStyle(node).position === "fixed") score += 20;
    if (getComputedStyle(node).position === "absolute") score += 12;
    return score;
  }

  async function renderJobPoster(job) {
    const width = 1080;
    const margin = 72;
    const contentWidth = width - margin * 2;
    const tempCanvas = document.createElement("canvas");
    const tempCtx = tempCanvas.getContext("2d");
    const headerLayout = layoutHeader(tempCtx, job.title, contentWidth);
    const descriptionLines = layoutDescription(tempCtx, job.description, contentWidth);
    const maxLines = 330;
    const clipped = descriptionLines.length > maxLines;
    const visibleLines = clipped ? descriptionLines.slice(0, maxLines) : descriptionLines;
    const bodyHeight = visibleLines.reduce((sum, line) => sum + line.height, 0);
    const height = Math.min(32000, 585 + headerLayout.extraHeight + bodyHeight + 432);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    drawBackground(ctx, width, height);
    drawHeader(ctx, job, margin, width, headerLayout);

    let y = headerLayout.contentStartY;
    ctx.fillStyle = "#1f262b";
    ctx.font = '700 48px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("职位详情", margin, y);
    y += 82;

    for (const line of visibleLines) {
      ctx.fillStyle = line.heading ? "#293136" : "#5c6468";
      ctx.font = `${line.heading ? "600" : "400"} ${line.size}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillText(line.text, margin, y);
      y += line.height;
    }

    if (clipped) {
      y += 12;
      ctx.fillStyle = "#7a8589";
      ctx.font = '400 34px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText("更多完整内容请扫码查看职位详情", margin, y);
      y += 56;
    }

    y = Math.min(y + 48, height - 338);
    await drawQrCard(ctx, job, margin, y, contentWidth);
    drawVersionStamp(ctx, width, height, margin);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片导出失败。"));
      }, "image/png", 0.95);
    });
  }

  function drawBackground(ctx, width, height) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    const gradient = ctx.createLinearGradient(0, 0, width, 360);
    gradient.addColorStop(0, "#bdf8f4");
    gradient.addColorStop(0.42, "#effcfb");
    gradient.addColorStop(1, "#fff1eb");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, 386);

    const fade = ctx.createLinearGradient(0, 275, 0, 430);
    fade.addColorStop(0, "rgba(255,255,255,0)");
    fade.addColorStop(1, "#ffffff");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 275, width, 170);
  }

  function drawHeader(ctx, job, margin, width, layout = layoutHeader(ctx, job.title, width - margin * 2)) {
    drawDate(ctx, job.dateParts, width - margin, 96);

    ctx.font = '700 42px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle = "#0da8a6";
    const companyLead = safeText(job.company || "BOSS 直聘", 14);
    ctx.fillText(companyLead, margin, 198);
    const companyWidth = ctx.measureText(companyLead).width;
    ctx.fillStyle = "#4e585d";
    ctx.font = '400 42px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("正在招聘", margin + companyWidth + 8, 198);

    ctx.fillStyle = "#1f262b";
    ctx.font = '800 72px "PingFang SC", "Microsoft YaHei", sans-serif';
    layout.titleLines.forEach((line, index) => {
      ctx.fillText(line, margin, 304 + index * layout.titleLineHeight);
    });

    ctx.fillStyle = "#5c6468";
    ctx.font = '400 42px "PingFang SC", "Microsoft YaHei", sans-serif';
    const meta = buildMobileShareMeta(job).join("/");
    drawSingleLine(ctx, meta || "职位详情", margin, layout.metaY, width - margin * 2, 42);

    ctx.strokeStyle = "#edf1f2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin, layout.separatorY);
    ctx.lineTo(width - margin, layout.separatorY);
    ctx.stroke();
  }

  function layoutHeader(ctx, title, maxWidth) {
    const titleLineHeight = 84;
    ctx.font = '800 72px "PingFang SC", "Microsoft YaHei", sans-serif';
    const wrapped = wrapText(ctx, cleanInlineText(title) || "职位详情", maxWidth).filter(Boolean);
    const titleLines = wrapped.length ? wrapped.slice(0, 2) : ["职位详情"];

    if (wrapped.length > 2) {
      titleLines[1] = ellipsizeText(ctx, titleLines[1], maxWidth);
    }

    const extraHeight = Math.max(0, titleLines.length - 1) * titleLineHeight;
    return {
      titleLines,
      titleLineHeight,
      extraHeight,
      metaY: 405 + extraHeight,
      separatorY: 502 + extraHeight,
      contentStartY: 578 + extraHeight
    };
  }

  function drawDate(ctx, dateParts, right, baseline) {
    const day = dateParts?.day || "";
    const rest = dateParts?.rest || "";
    ctx.textAlign = "right";
    ctx.fillStyle = "#4e585d";

    ctx.font = '500 40px "PingFang SC", "Microsoft YaHei", sans-serif';
    const restWidth = ctx.measureText(rest).width;
    ctx.fillText(rest, right, baseline);

    ctx.font = '600 56px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(day, right - restWidth, baseline);
    ctx.textAlign = "left";
  }

  async function drawQrCard(ctx, job, x, y, width) {
    const height = 238;
    roundRect(ctx, x, y, width, height, 26);
    ctx.fillStyle = "#f4f6f6";
    ctx.fill();

    ctx.fillStyle = "#0da8a6";
    ctx.font = '800 38px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("BOSS ZHIPIN", x + 54, y + 76);

    ctx.fillStyle = "#222a2f";
    ctx.font = '800 44px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(DEFAULT_QR_TEXT, x + 54, y + 142);

    ctx.fillStyle = "#5e696e";
    ctx.font = '400 32px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("找工作，BOSS直聘直接谈！", x + 54, y + 190);

    const qrSize = 172;
    const qrX = x + width - qrSize - 62;
    const qrY = y + 34;

    if (job.qrDataUrl) {
      try {
        const image = await loadImage(job.qrDataUrl);
        ctx.drawImage(image, qrX, qrY, qrSize, qrSize);
        return;
      } catch {
        // Draw fallback below.
      }
    }

    ctx.strokeStyle = "#cfd9dc";
    ctx.lineWidth = 3;
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 18);
    ctx.stroke();
    ctx.fillStyle = "#8a969a";
    ctx.textAlign = "center";
    ctx.font = '500 25px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText("二维码", qrX + qrSize / 2, qrY + 76);
    ctx.fillText("未获取", qrX + qrSize / 2, qrY + 112);
    ctx.textAlign = "left";
  }

  function drawVersionStamp(ctx, width, height, margin) {
    ctx.fillStyle = "#c2cbcf";
    ctx.textAlign = "right";
    ctx.font = '400 22px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(`BOSS 职位长图分享 v${EXTENSION_VERSION}`, width - margin, height - 54);
    ctx.fillText(PROJECT_URL, width - margin, height - 24);
    ctx.textAlign = "left";
  }

  function layoutDescription(ctx, description, maxWidth) {
    const blocks = normalizeDescription(description).split("\n").filter(Boolean);
    const lines = [];

    for (const block of blocks) {
      const size = 36;
      const lineHeight = 58;
      ctx.font = `400 ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`;

      for (const wrapped of wrapText(ctx, block, maxWidth)) {
        lines.push({ text: wrapped, size, height: lineHeight, heading: false });
      }

      lines.push({ text: "", size, height: 8, heading: false });
    }

    return lines;
  }

  function wrapText(ctx, text, maxWidth) {
    const chunks = Array.from(text);
    const lines = [];
    let current = "";

    for (const chunk of chunks) {
      const next = current + chunk;
      if (ctx.measureText(next).width <= maxWidth || !current) {
        current = next;
      } else {
        lines.push(current.trimEnd());
        current = chunk.trimStart();
      }
    }

    if (current) lines.push(current.trimEnd());
    return lines;
  }

  function drawSingleLine(ctx, text, x, y, maxWidth, size) {
    let value = cleanInlineText(text);
    while (value && ctx.measureText(value).width > maxWidth) {
      value = value.slice(0, -1);
    }
    ctx.fillText(value === text ? value : `${value.slice(0, -1)}...`, x, y);
  }

  function ellipsizeText(ctx, text, maxWidth) {
    const suffix = "...";
    let value = cleanInlineText(text);
    while (value && ctx.measureText(`${value}${suffix}`).width > maxWidth) {
      value = value.slice(0, -1);
    }
    return value ? `${value}${suffix}` : suffix;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("二维码载入失败"));
      image.src = src;
    });
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function fileName(job) {
    const title = (job.title || "BOSS职位").replace(/[\\/:*?"<>|]/g, "").slice(0, 24);
    return `${title}-职位长图.png`;
  }

  function notify(text, error = false) {
    const previous = document.querySelector(".boss-share-long-image-toast");
    previous?.remove();

    const toast = document.createElement("div");
    toast.className = `boss-share-long-image-toast${error ? " is-error" : ""}`;
    toast.textContent = text;
    document.documentElement.appendChild(toast);
    window.setTimeout(() => toast.remove(), error ? 5200 : 2600);
  }

  function visibleText(node) {
    if (!node) return "";
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(textNode) {
        const parent = textNode.parentElement;
        if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
        const text = textNode.nodeValue.replace(/\s+/g, " ").trim();
        return text ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const parts = [];
    let current;
    while ((current = walker.nextNode())) parts.push(current.nodeValue.trim());
    return parts.join("\n");
  }

  function nodeText(node) {
    if (!node) return "";
    return node.innerText || visibleText(node);
  }

  function isVisible(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function area(node) {
    const rect = node.getBoundingClientRect();
    return rect.width * rect.height;
  }

  function centerY(rect) {
    return rect.top + rect.height / 2;
  }

  function findMarkerTop(root, matcher) {
    const marker = [...root.querySelectorAll("h2, h3, p, span, div")]
      .filter(isVisible)
      .map((node) => ({ node, text: cleanInlineText(node.innerText || node.textContent || ""), rect: node.getBoundingClientRect() }))
      .filter(({ text }) => matcher.test(text))
      .sort((a, b) => a.rect.top - b.rect.top)[0];

    return marker?.rect.top || 0;
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeDescription(text) {
    return normalizeText(text)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^(微信扫码分享|举报|收藏|立即沟通|去App|与BOSS随时沟通)$/.test(line))
      .join("\n");
  }

  function trimDescriptionTail(description) {
    const lines = normalizeDescription(description).split("\n").filter(Boolean);

    while (lines.length) {
      const last = cleanInlineText(lines[lines.length - 1]);
      if (isNonDescriptionTailLine(last)) {
        lines.pop();
        continue;
      }
      break;
    }

    return lines.join("\n");
  }

  function isNonDescriptionTailLine(line) {
    if (!line) return true;
    if (/^[\u4e00-\u9fa5]{1,4}(先生|女士)$/.test(line)) return true;
    if (/^(先生|女士|刚刚活跃|今日活跃|去App|与BOSS随时沟通|微信扫码分享|举报|收藏|立即沟通)$/.test(line)) return true;
    if (/^[\u4e00-\u9fa5A-Za-z0-9（）()\s·・]{2,32}[·・]\s*(人事|招聘|HR|经理|总监|负责人|主管|专员)/.test(line)) return true;
    return false;
  }

  function cleanInlineText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function hasPrivateUseText(text) {
    return /[\ue000-\uf8ff]/.test(stripBossPrivateDigits(text));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cleanSalary(value) {
    return normalizeSalaryText(value)
      .replace(/\s+/g, "")
      .replace(/[-‐‑‒–—―−~～－]/g, "-")
      .replace(/／/g, "/")
      .replace(/k/g, "K");
  }

  function normalizeSalaryText(value) {
    return stripBossPrivateDigits(cleanInlineText(value))
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/[﹣−]/g, "-")
      .replace(/／/g, "/");
  }

  function stripBossPrivateDigits(value) {
    return String(value || "").replace(/[\ue031-\ue03a]/g, (char) => String(char.charCodeAt(0) - 0xe031));
  }

  function normalizeMetaPart(value) {
    return cleanInlineText(value)
      .replace(/\s*\/\s*/g, "/")
      .replace(/应届生/g, "应届")
      .replace(/在校生/g, "在校");
  }

  function splitMetaText(text) {
    const normalized = normalizeMetaPart(text);
    if (!normalized) return [];
    return normalized
      .split(/[｜|,，;；\s]+/)
      .flatMap((part) => part.includes("/") && /在校\/应届/.test(part) ? part.split("/") : [part])
      .map(normalizeMetaPart)
      .filter(Boolean);
  }

  function isLikelyMetaText(text, title, salary) {
    const value = normalizeMetaPart(text);
    if (!value || value === title || value === salary) return false;
    if (SALARY_RE.test(value)) return false;
    if (/职位描述|岗位职责|任职要求|工作地址|微信扫码分享|收藏|立即沟通|举报|扫码|去App|BOSS|今日活跃/.test(value)) return false;
    if (value.length > 24 && !/[\s｜|,，;；]/.test(value)) return false;

    return splitMetaText(value).some((part) => {
      return isCityMeta(part) ||
        /^(\d+天\/周|\d+个月|\d+年|\d+\s*[-–]\s*\d+年|\d+年以上|经验不限|在校|应届|实习|本科|大专|硕士|博士|中专\/中技|高中|学历不限|不限)$/.test(part);
    });
  }

  function isRedLike(color) {
    const match = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return false;
    const [, r, g, b] = match.map(Number);
    return r > 200 && g >= 50 && g < 130 && b >= 40 && b < 130;
  }

  function buildMobileShareMeta(job) {
    if (Array.isArray(job.manualMobileMetaParts) && job.manualMobileMetaParts.length) {
      return [...new Set(job.manualMobileMetaParts.filter(Boolean).map(normalizeMetaPart))];
    }

    const parts = [];
    const degree = job.degree || findDegree(job.metaParts || []);
    const rawParts = job.metaParts || [];

    if (job.city) parts.push(job.city);
    if (job.salary) parts.push(job.salary);

    const mobileParts = rawParts.filter((part) => {
      if (!part || part === job.city || part === job.salary || part === degree) return false;
      return /(\d+\s*[-–]\s*\d+年|\d+年以上|经验不限|\d+天\/周|\d+个月|\d+年|在校|应届|实习|不限|学历不限)/.test(part);
    });
    parts.push(...mobileParts);

    if (degree) parts.push(degree);
    return [...new Set(parts.filter(Boolean).map(normalizeMetaPart))];
  }

  function isUsableSalary(salary) {
    const value = cleanSalary(salary);
    return Boolean(value && value !== "面议" && SALARY_RE.test(value));
  }

  function isInternJob(salary, metaParts, text) {
    const params = new URLSearchParams(location.search);
    return params.get("jobType") === "1902" ||
      /元\/天|元\/时|元\/周/.test(cleanSalary(salary)) ||
      (metaParts || []).some((part) => /\d+天\/周|\d+个月|在校|应届|实习/.test(part)) ||
      /实习|校招|在校|应届/.test(text.slice(0, 1200));
  }

  function findDegree(parts) {
    return (parts || []).map(normalizeMetaPart).find((part) => /^(博士|硕士|本科|大专|中专\/中技|高中|学历不限)$/.test(part)) || "";
  }

  function removeSalary(text) {
    return cleanInlineText(text.replace(SALARY_RE, ""));
  }

  function safeText(text, maxLength) {
    const value = cleanInlineText(text);
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
  }

  function readPageDataText() {
    return [...document.scripts]
      .map((script) => script.textContent || "")
      .filter((text) => /job|salary|职位|薪|元[\/／]天|K|boss/i.test(text))
      .join("\n")
      .slice(0, 240000);
  }

  function findCurrentJobNodes(title) {
    if (!title) return [];

    const selectors = [
      ".job-card-wrapper",
      ".job-card-box",
      ".job-list-box li",
      ".job-list li",
      "[class*='job-card']",
      "[class*='job-list'] li"
    ];
    const nodes = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (!isVisible(node)) return;
        const text = cleanInlineText(node.innerText || node.textContent || "");
        if (text.includes(title) && SALARY_RE.test(text)) nodes.push(node);
      });
    }

    return [...new Set(nodes)].sort((a, b) => {
      const activeA = /active|selected|cur|current/.test(a.className || "") ? 1 : 0;
      const activeB = /active|selected|cur|current/.test(b.className || "") ? 1 : 0;
      return activeB - activeA;
    });
  }

  function findDetailPageUrl(title, root) {
    if (/\/job_detail\//.test(location.pathname)) return canonicalDetailPageUrl(location.href);

    const mobileShareUrl = detailUrlFromMobileSharePage();
    if (mobileShareUrl) return mobileShareUrl;

    const links = [...document.querySelectorAll("a[href*='/job_detail/']")]
      .map((link) => {
        const href = link.getAttribute("href");
        const text = cleanInlineText(link.innerText || link.textContent || "");
        const rect = link.getBoundingClientRect();
        const parentText = cleanInlineText(link.closest("li, [class*='job-card'], [class*='job-list'], div")?.innerText || "");
        let score = 0;
        if (title && (text.includes(title) || parentText.includes(title))) score += 80;
        if (/active|selected|cur|current/.test(link.className || "")) score += 20;
        if (rect.left < (root?.getBoundingClientRect?.().left || window.innerWidth)) score += 8;
        const inDetail = root && jobFieldScope(root).contains(link);
        const matchesTitle = title && (text === title || parentText.includes(title));
        if (!inDetail && !matchesTitle) return null;
        if (inDetail) score += 120;
        const detailUrl = href ? canonicalDetailPageUrl(href) : "";
        return detailUrl ? { href: detailUrl, score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    const best = links[0];
    if (!best || links.some((item) => item.score === best.score && item.href !== best.href)) return "";
    return best.href;
  }

  function canonicalDetailPageUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (!/^\/job_detail\/[^/?#]+\.html$/i.test(url.pathname)) return "";
      return `https://www.zhipin.com${url.pathname}`;
    } catch {
      return "";
    }
  }

  function detailUrlFromMobileSharePage() {
    if (location.hostname !== "m.zhipin.com") return "";

    const match = location.pathname.match(/\/weijd-job\/([^/?#]+)/);
    if (!match) return "";

    const jobId = decodeURIComponent(match[1]).replace(/\.html$/i, "");
    return jobId ? `https://www.zhipin.com/job_detail/${encodeURIComponent(jobId)}.html` : "";
  }

  function sameUrl(a, b) {
    try {
      return new URL(a, location.href).href === new URL(b, location.href).href;
    } catch {
      return false;
    }
  }

  function pickSalaryFromDetailHtml(html, title) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = normalizeSalaryText(doc.body?.textContent || "");
    const lines = text.split(/\n+/).map(cleanInlineText).filter(Boolean);
    const titleLine = lines.find((line) => title && line.includes(title) && SALARY_RE.test(line));
    const titleMatch = titleLine?.match(SALARY_RE)?.[0];
    if (titleMatch) return cleanSalary(titleMatch);

    const firstMatch = text.match(SALARY_RE)?.[0];
    return firstMatch ? cleanSalary(firstMatch) : "";
  }

  function pickCompanyFromDetailHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = normalizeText(doc.body?.textContent || "");
    const recruiterLine = text.split(/\n+/)
      .map(cleanInlineText)
      .find((line) => /[·・]/.test(line) && /(招聘|人事|HR|经理|总监|负责人|主管|专员)/.test(line));
    return companyFromRecruiter(recruiterLine || "");
  }

  function between(text, start, endMarkers) {
    const startIndex = text.indexOf(start);
    if (startIndex < 0) return "";
    const rest = text.slice(startIndex + start.length);
    const endIndex = endMarkers
      .map((marker) => rest.indexOf(marker))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    return endIndex >= 0 ? rest.slice(0, endIndex) : rest;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function formatDate(date) {
    const month = date.toLocaleString("en-US", { month: "short" });
    return `${date.getDate()}${month}.${date.getFullYear()}`;
  }

  function formatDateParts(date) {
    const month = date.toLocaleString("en-US", { month: "short" });
    return {
      day: String(date.getDate()),
      rest: `${month}.${date.getFullYear()}`
    };
  }
})();
