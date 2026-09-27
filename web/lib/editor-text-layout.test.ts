import { describe, expect, it } from "vitest";
import { clampEditorTextOverlay, editorTextOverlayOffset } from "./editor-text-layout";
import { createEditorTextOverlay } from "./editor-overlay-preview";
import { createEditorRenderSpec } from "./editor-render-spec";
import { readFileSync } from "node:fs";

function overlay() {
  return { ...createEditorTextOverlay("test", 30), text: "첫 줄", offset: { x: 0, y: -906 } };
}

describe("text geometry shared by live edits and saved preview", () => {
  it("keeps a one-line top edge and moves all three lines into the same worker bounds", () => {
    const one = overlay();
    expect(editorTextOverlayOffset(one).y).toBe(-906);
    const three = clampEditorTextOverlay({ ...one, text: "첫 줄\n두 번째 줄\n세 번째 줄" });
    expect(three.offset).toEqual({ x: 0, y: -820 });
    const document = JSON.parse(readFileSync(new URL("../../test-fixtures/editor-document-v2.json", import.meta.url), "utf8"));
    document.overlays.textOverlays = [three];
    const spec = createEditorRenderSpec(document).textOverlays[0];
    expect(spec.centerY).toBe((spec.lineHeight * spec.lines.length + 22) / 2);
  });
  it("uses saved line geometry when reopening existing documents", () => {
    const document = JSON.parse(readFileSync(new URL("../../test-fixtures/editor-document-v2.json", import.meta.url), "utf8"));
    const three = { ...overlay(), text: "첫 줄\n둘째\n셋째" };
    document.overlays.textOverlays = [three];
    const spec = createEditorRenderSpec(document).textOverlays[0];
    expect(editorTextOverlayOffset(three, spec).y).toBe(-820);
  });
  it("clamps the bottom and centers layers taller or wider than the canvas", () => {
    const text = { ...overlay(), text: "가\n나\n다", offset: { x: 0, y: 900 } };
    expect(clampEditorTextOverlay(text).offset.y).toBe(820);
    expect(clampEditorTextOverlay({ ...text, text: Array(20).fill("가").join("\n"), scale: 2 }).offset).toEqual({ x: 0, y: 0 });
  });
  it("preserves an in-bounds edit and mirrors the worker's horizontal recentering", () => {
    const normal = { ...overlay(), offset: { x: 30, y: 100 } };
    expect(clampEditorTextOverlay(normal)).toEqual(normal);
    expect(clampEditorTextOverlay({ ...normal, offset: { x: 400, y: 100 } }).offset).toEqual({ x: 0, y: 100 });
  });
});
