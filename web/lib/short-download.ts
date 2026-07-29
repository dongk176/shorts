export function shortDownloadFilename(hookTitle: string) {
  const safeTitle = hookTitle
    .replace(/[^0-9A-Za-z가-힣 _-]/g, "")
    .trim()
    .slice(0, 80);
  return `${safeTitle || "shorts"}.mp4`;
}

export function shortDownloadExpirySeconds(
  outputExpiresAt: Date | string | null,
  now = Date.now(),
) {
  if (!outputExpiresAt) return 300;
  const remainingSeconds = Math.floor(
    (new Date(outputExpiresAt).getTime() - now) / 1_000,
  );
  return Math.max(1, Math.min(300, remainingSeconds));
}

export function isIosDownloadDevice(
  userAgent: string,
  maxTouchPoints = 0,
) {
  return /iPhone|iPad|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}
