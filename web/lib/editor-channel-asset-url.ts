export function editorChannelAssetPreviewUrl(
  shortId: string,
  renderVersion: number,
) {
  return `/api/shorts/${encodeURIComponent(shortId)}/editor-channel-asset?renderVersion=${encodeURIComponent(String(renderVersion))}`;
}
