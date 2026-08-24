export const EDITOR_CHANNEL_PRESET_STORAGE_KEY =
  "easycut:editor-channel-presets:v1";
export const EDITOR_CHANNEL_PRESET_LIMIT = 8;
export const EDITOR_CHANNEL_PRESET_IMAGE_MAX_LENGTH = 400_000;

export type EditorChannelPreset = {
  id: string;
  name: string;
  imageDataUrl: string;
};

function isEditorChannelPreset(value: unknown): value is EditorChannelPreset {
  if (!value || typeof value !== "object") return false;
  const preset = value as Partial<EditorChannelPreset>;
  return Boolean(
    typeof preset.id === "string"
    && preset.id.length > 0
    && preset.id.length <= 100
    && typeof preset.name === "string"
    && preset.name.trim().length > 0
    && preset.name.length <= 50
    && typeof preset.imageDataUrl === "string"
    && preset.imageDataUrl.length <= EDITOR_CHANNEL_PRESET_IMAGE_MAX_LENGTH
    && /^data:image\/(?:png|jpeg|webp);base64,/i.test(preset.imageDataUrl),
  );
}

export function parseEditorChannelPresets(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed
      || typeof parsed !== "object"
      || (parsed as { version?: unknown }).version !== 1
      || !Array.isArray((parsed as { items?: unknown }).items)
    ) {
      return [];
    }
    const seen = new Set<string>();
    return (parsed as { items: unknown[] }).items
      .filter(isEditorChannelPreset)
      .filter((preset) => {
        if (seen.has(preset.id)) return false;
        seen.add(preset.id);
        return true;
      })
      .slice(0, EDITOR_CHANNEL_PRESET_LIMIT)
      .map((preset) => ({
        ...preset,
        name: preset.name.trim(),
      }));
  } catch {
    return [];
  }
}

export function serializeEditorChannelPresets(
  presets: EditorChannelPreset[],
) {
  return JSON.stringify({
    version: 1,
    items: presets.slice(0, EDITOR_CHANNEL_PRESET_LIMIT),
  });
}
