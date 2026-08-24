import { describe, expect, it } from "vitest";
import {
  EDITOR_CHANNEL_PRESET_LIMIT,
  parseEditorChannelPresets,
  serializeEditorChannelPresets,
  type EditorChannelPreset,
} from "@/lib/editor-channel-presets";

const imageDataUrl = `data:image/webp;base64,${"a".repeat(40)}`;

describe("editor channel presets", () => {
  it("round-trips versioned browser storage", () => {
    const presets: EditorChannelPreset[] = [{
      id: "channel-1",
      name: "내 채널",
      imageDataUrl,
    }];
    expect(parseEditorChannelPresets(
      serializeEditorChannelPresets(presets),
    )).toEqual(presets);
  });

  it("rejects malformed, remote, and unversioned values", () => {
    expect(parseEditorChannelPresets("{")).toEqual([]);
    expect(parseEditorChannelPresets(JSON.stringify({
      items: [],
    }))).toEqual([]);
    expect(parseEditorChannelPresets(JSON.stringify({
      version: 1,
      items: [{
        id: "channel-1",
        name: "내 채널",
        imageDataUrl: "https://example.com/avatar.png",
      }],
    }))).toEqual([]);
  });

  it("deduplicates ids and enforces the preset limit", () => {
    const items = Array.from(
      { length: EDITOR_CHANNEL_PRESET_LIMIT + 3 },
      (_, index) => ({
        id: `channel-${Math.min(index, EDITOR_CHANNEL_PRESET_LIMIT)}`,
        name: `채널 ${index}`,
        imageDataUrl,
      }),
    );
    const parsed = parseEditorChannelPresets(JSON.stringify({
      version: 1,
      items,
    }));
    expect(parsed).toHaveLength(EDITOR_CHANNEL_PRESET_LIMIT);
    expect(new Set(parsed.map((preset) => preset.id)).size).toBe(
      EDITOR_CHANNEL_PRESET_LIMIT,
    );
  });
});
