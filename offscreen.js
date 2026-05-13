chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "BOSS_OFFSCREEN_COPY_IMAGE") return false;

  copyImage(message.dataUrl)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function copyImage(dataUrl) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前浏览器不支持图片剪贴板写入");
  }

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || "image/png"]: blob })
  ]);
}
