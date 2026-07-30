type EditorOverlayPreviewEnvironment = {
  NODE_ENV?: string;
  EDITOR_OVERLAY_PREVIEW_ENABLED?: string;
};

export function editorOverlayPreviewEnabled(
  environment: EditorOverlayPreviewEnvironment = process.env,
) {
  if (environment.NODE_ENV === "production") return false;
  return environment.EDITOR_OVERLAY_PREVIEW_ENABLED?.trim().toLowerCase() === "true";
}
