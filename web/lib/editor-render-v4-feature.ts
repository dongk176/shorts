export const EDITOR_RENDER_SPEC_V4_ENV =
  "NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED" as const;

export function isEditorRenderSpecV4Enabled() {
  return process.env.NEXT_PUBLIC_EDITOR_RENDER_SPEC_V4_ENABLED === "true";
}
