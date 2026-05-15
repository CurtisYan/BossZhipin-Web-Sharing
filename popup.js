const DEBUG_MODE_KEY = "bossShareDebugMode";
const OUTPUT_MODE_KEY = "bossShareOutputMode";
const OUTPUT_MODE_COPY = "copy";
const OUTPUT_MODE_DOWNLOAD = "download";
const README_URL = "https://github.com/CurtisYan/BossZhipin-Web-Sharing#readme";
const RELEASES_URL = "https://github.com/CurtisYan/BossZhipin-Web-Sharing/releases/latest";
const debugToggle = document.querySelector("#debug-mode");
const outputModeInputs = [...document.querySelectorAll("input[name='output-mode']")];
const workflowLink = document.querySelector("#workflow-link");
const updateCard = document.querySelector("#update-card");
const updateVersion = document.querySelector("#update-version");
const statusNode = document.querySelector("#status");

init();

async function init() {
  const stored = await chrome.storage.local.get({
    [DEBUG_MODE_KEY]: false,
    [OUTPUT_MODE_KEY]: OUTPUT_MODE_COPY
  });
  debugToggle.checked = Boolean(stored[DEBUG_MODE_KEY]);
  setOutputModeSelection(stored[OUTPUT_MODE_KEY]);

  debugToggle.addEventListener("change", async () => {
    const enabled = debugToggle.checked;
    await chrome.storage.local.set({ [DEBUG_MODE_KEY]: enabled });
    await notifyActiveTab({ type: "BOSS_SET_DEBUG_MODE", enabled }).catch(() => {});
    statusNode.textContent = enabled ? "调试模式已开启，网页会显示“调试字段”按钮。" : "调试模式已关闭。";
  });

  outputModeInputs.forEach((input) => {
    input.addEventListener("change", async () => {
      if (!input.checked) return;
      const mode = normalizeOutputMode(input.value);
      await chrome.storage.local.set({ [OUTPUT_MODE_KEY]: mode });
      await notifyActiveTab({ type: "BOSS_SET_OUTPUT_MODE", mode }).catch(() => {});
      statusNode.textContent = mode === OUTPUT_MODE_DOWNLOAD ? "做长图后会直接下载 PNG。" : "做长图后会优先复制到剪贴板。";
    });
  });

  workflowLink.addEventListener("click", async () => {
    await chrome.tabs.create({ url: README_URL });
    window.close();
  });

  updateCard.addEventListener("click", async () => {
    await chrome.tabs.create({ url: updateCard.dataset.url || RELEASES_URL });
    window.close();
  });

  refreshUpdateCard();
}

async function notifyActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/([^/]+\.)?zhipin\.com\//.test(tab.url || "")) return;

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!String(error?.message || "").includes("Receiving end does not exist")) throw error;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, message);
  }
}

function setOutputModeSelection(mode) {
  const nextMode = normalizeOutputMode(mode);
  outputModeInputs.forEach((input) => {
    input.checked = input.value === nextMode;
  });
}

function normalizeOutputMode(mode) {
  return mode === OUTPUT_MODE_DOWNLOAD ? OUTPUT_MODE_DOWNLOAD : OUTPUT_MODE_COPY;
}

async function refreshUpdateCard() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "BOSS_CHECK_UPDATE", force: false });
    if (!response?.ok || !response.updateAvailable) {
      updateCard.hidden = true;
      return;
    }

    updateVersion.textContent = `v${response.latestVersion}`;
    updateCard.dataset.url = response.releaseUrl || RELEASES_URL;
    updateCard.hidden = false;
  } catch {
    updateCard.hidden = true;
  }
}
