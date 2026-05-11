chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "BOSS_FETCH_AS_DATA_URL") return false;

  fetchAsDataUrl(message.url)
    .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

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
