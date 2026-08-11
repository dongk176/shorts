import { describe, expect, it } from "vitest";
import {
  cloneEditorCopySnapshot,
  recordEditorCopyHistory,
  redoEditorCopyHistory,
  undoEditorCopyHistory,
  type EditorCopyHistory,
  type EditorCopySnapshot,
} from "./editor-copy-history";

const snapshot = (overrides: Partial<EditorCopySnapshot> = {}): EditorCopySnapshot => ({
  title: "후킹 제목",
  titleTextStyles: [],
  titleFontScale: 1,
  channel: "채널",
  channelThumbnailUrl: null,
  channelThumbnailAssetKey: null,
  subtitlesEnabled: true,
  subtitleSegments: [{ start: 0, end: 1, text: "원본" }],
  subtitleLayout: { offsetY: 0, scale: 1 },
  ...overrides,
});

const emptyHistory = (): EditorCopyHistory => ({ past: [], future: [] });

describe("editor copy history", () => {
  it("round-trips a caption text edit through undo and redo", () => {
    const before = snapshot();
    const after = snapshot({
      subtitleLayout: {
        offsetY: 0,
        scale: 1,
        cueEdits: [{ cueIndex: 7, text: "수정한 자막" }],
      },
    });
    const recorded = recordEditorCopyHistory(emptyHistory(), before, after);
    const undone = undoEditorCopyHistory(recorded);
    expect(undone.snapshot?.subtitleLayout.cueEdits).toBeUndefined();
    const redone = redoEditorCopyHistory(undone.history);
    expect(redone.snapshot?.subtitleLayout.cueEdits)
      .toEqual([{ cueIndex: 7, text: "수정한 자막" }]);
  });

  it("undoes and redoes restoring a caption edit back to its source text", () => {
    const edited = snapshot({
      subtitleLayout: {
        offsetY: 0,
        scale: 1,
        cueEdits: [{ cueIndex: 7, text: "수정한 자막" }],
      },
    });
    const restored = snapshot();
    const recorded = recordEditorCopyHistory(emptyHistory(), edited, restored);
    const undone = undoEditorCopyHistory(recorded);
    expect(undone.snapshot?.subtitleLayout.cueEdits)
      .toEqual([{ cueIndex: 7, text: "수정한 자막" }]);
    const redone = redoEditorCopyHistory(undone.history);
    expect(redone.snapshot?.subtitleLayout.cueEdits).toBeUndefined();
  });

  it("keeps subtitle visibility, font, color, position and scale in one snapshot", () => {
    const before = snapshot();
    const after = snapshot({
      subtitlesEnabled: false,
      subtitleLayout: {
        offsetY: 632,
        scale: 1.25,
        fontId: "jua",
        accentColor: "#35E6E3",
      },
    });
    const recorded = recordEditorCopyHistory(emptyHistory(), before, after);
    const undone = undoEditorCopyHistory(recorded);
    expect(undone.snapshot).toMatchObject({
      subtitlesEnabled: true,
      subtitleLayout: { offsetY: 0, scale: 1 },
    });
    const redone = redoEditorCopyHistory(undone.history);
    expect(redone.snapshot).toMatchObject({
      subtitlesEnabled: false,
      subtitleLayout: {
        offsetY: 632,
        scale: 1.25,
        fontId: "jua",
        accentColor: "#35E6E3",
      },
    });
  });

  it("clears redo after a new edit and keeps stored snapshots immutable", () => {
    const before = snapshot();
    const first = snapshot({
      subtitleLayout: { offsetY: 100, scale: 1 },
    });
    const recorded = recordEditorCopyHistory(emptyHistory(), before, first);
    const undone = undoEditorCopyHistory(recorded);
    const replacement = snapshot({
      subtitleLayout: { offsetY: -200, scale: 1.5 },
    });
    const next = recordEditorCopyHistory(
      undone.history,
      cloneEditorCopySnapshot(undone.snapshot || before),
      replacement,
    );
    replacement.subtitleLayout.offsetY = 900;
    expect(next.future).toEqual([]);
    expect(next.past.at(-1)?.after.subtitleLayout)
      .toEqual({ offsetY: -200, scale: 1.5 });
  });
});
