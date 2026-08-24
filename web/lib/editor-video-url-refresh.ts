export const EDITOR_VIDEO_URL_REFRESH_LEAD_MS = 2 * 60_000;
export const EDITOR_VIDEO_URL_MIN_REFRESH_DELAY_MS = 1_000;

export function editorVideoUrlRefreshDelay(
  expiresAt: string,
  now = Date.now(),
) {
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration)) {
    return EDITOR_VIDEO_URL_MIN_REFRESH_DELAY_MS;
  }
  return Math.max(
    EDITOR_VIDEO_URL_MIN_REFRESH_DELAY_MS,
    expiration - now - EDITOR_VIDEO_URL_REFRESH_LEAD_MS,
  );
}
