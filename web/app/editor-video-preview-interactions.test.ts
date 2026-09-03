import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  new URL("./shorts-app.tsx", import.meta.url),
  "utf8",
);

describe("editor video preview interactions", () => {
  it("uses one resolved base frame for the video and its loading placeholder", () => {
    expect(editorSource).toContain(
      "const editorVideoBaseRect: CanvasRect = resolveEditorVideoPreviewFrame({",
    );
    expect(editorSource).toContain(
      "const editorVideoBaseStyle = customVideoFrameStyle(editorVideoBaseRect);",
    );
    expect(editorSource.match(/\.\.\.editorVideoBaseStyle,/g)).toHaveLength(2);
    expect(editorSource).not.toContain(
      "captionTemplatePreviewSnapshot.layout.video.x / 10.8",
    );
  });

  it("gives video movement its own five-pixel center snap threshold", () => {
    expect(editorSource).toContain(
      "const EDITOR_VIDEO_CENTER_SNAP_THRESHOLD_PX = 5;",
    );
    expect(editorSource).toContain(
      "const snapped = snapVideoRectForMove(",
    );
    expect(editorSource).toContain(
      "EDITOR_VIDEO_CENTER_SNAP_THRESHOLD_PX,",
    );
  });

  it("keeps a twelve-pixel handle inside a twenty-eight-pixel touch target", () => {
    expect(editorSource).toContain(
      "absolute h-7 w-7 touch-none border-0 bg-transparent",
    );
    expect(editorSource).toContain(
      "absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2",
    );
    expect(editorSource).toContain(
      'positionClassName: "-left-3.5 -top-3.5"',
    );
    expect(editorSource).toContain(
      'positionClassName: "-bottom-3.5 -right-3.5"',
    );
  });
});
