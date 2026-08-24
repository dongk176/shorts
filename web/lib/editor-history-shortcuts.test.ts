import { describe, expect, it } from "vitest";
import { resolveEditorHistoryShortcut } from "./editor-history-shortcuts";

const shortcut = (
  values: Partial<Parameters<typeof resolveEditorHistoryShortcut>[0]>,
) => resolveEditorHistoryShortcut({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  isComposing: false,
  ...values,
});

describe("resolveEditorHistoryShortcut", () => {
  it("supports macOS undo and redo", () => {
    expect(shortcut({ code: "KeyZ", metaKey: true })).toBe("undo");
    expect(shortcut({ code: "KeyZ", metaKey: true, shiftKey: true })).toBe("redo");
  });

  it("supports Windows undo and both common redo shortcuts", () => {
    expect(shortcut({ code: "KeyZ", ctrlKey: true })).toBe("undo");
    expect(shortcut({ code: "KeyZ", ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(shortcut({ code: "KeyY", ctrlKey: true })).toBe("redo");
  });

  it("ignores unmodified and Alt-modified keys", () => {
    expect(shortcut({ code: "KeyZ" })).toBeNull();
    expect(shortcut({ code: "KeyZ", ctrlKey: true, altKey: true })).toBeNull();
  });

  it("does not intercept undo or redo while an IME composition is active", () => {
    expect(shortcut({
      code: "KeyZ",
      metaKey: true,
      isComposing: true,
    })).toBeNull();
    expect(shortcut({
      code: "KeyY",
      ctrlKey: true,
      isComposing: true,
    })).toBeNull();
    expect(shortcut({
      code: "KeyZ",
      metaKey: true,
      keyCode: 229,
    })).toBeNull();
  });
});
