import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("editor v2 viewport zoom", () => {
  const editorSource = source("./shorts-app.tsx");
  const styles = source("./editor-v2.css");

  it("keeps the preview fixed while timeline zoom remains local view state", () => {
    expect(editorSource).not.toContain("editorPreviewZoom");
    expect(editorSource).toContain(
      "const [editorTimelineZoom, setEditorTimelineZoom] = useState(1)",
    );
    expect(editorSource).not.toContain("transform: `scale(${editorPreviewZoom})`");
    expect(editorSource).toContain(
      "width: `${editorTimelineZoom * 100}%`",
    );
  });

  it("keeps only the timeline zoom control within conservative limits", () => {
    expect(editorSource).not.toContain("EDITOR_PREVIEW_ZOOM_MAX");
    expect(editorSource).toContain("const EDITOR_TIMELINE_ZOOM_MAX = 3");
    expect(editorSource).toContain('label="오버레이"');
    expect(editorSource).not.toContain('className="editor-preview-zoom-control"');
  });

  it("blocks Mac trackpad pinch inside the fixed preview", () => {
    expect(editorSource).toContain("const editorPreviewViewportRef = useRef<HTMLDivElement>(null)");
    expect(editorSource).toContain("if (!event.ctrlKey) return");
    expect(editorSource).toContain("event.preventDefault()");
    expect(editorSource).toContain(
      'viewport.addEventListener("wheel", preventPreviewPinch, { passive: false })',
    );
    expect(editorSource).not.toContain("setEditorPreviewZoom");
  });

  it("locks the desktop preview to 9 by 16 in the v2 root", () => {
    expect(styles).toContain(
      ".editor-v2-root .editor-preview-pane.has-range-editor .editor-preview-canvas-wrap",
    );
    expect(styles).toContain("width: auto;");
    expect(styles).toContain("aspect-ratio: 9/16;");
  });

  it("keeps the fixed preview clipped inside its viewport", () => {
    expect(editorSource).toContain('className="editor-preview-canvas-viewport"');
    expect(styles).toContain(".editor-v2-root .editor-preview-canvas-viewport {");
    expect(styles).toContain("overflow: hidden;");
    expect(styles).toContain(
      ".editor-v2-root .editor-preview-canvas-viewport > [data-editor-preview-canvas]",
    );
  });

  it("keeps play centered and aligns fullscreen to the preview right edge", () => {
    expect(editorSource).toContain('className="editor-preview-play-control"');
    expect(editorSource).toContain(
      'className="editor-preview-fullscreen-control editor-preview-edge-fullscreen-control"',
    );
    expect(editorSource).toContain(
      '{!overlayPreviewEnabled && <button\n            type="button"\n            className="editor-preview-fullscreen-control"',
    );
    expect(styles).toContain(".editor-v2-root .editor-preview-play-control {");
    expect(styles).toContain("left: 50%;");
    expect(styles).toContain(".editor-v2-root .editor-preview-edge-fullscreen-control {");
    expect(styles).toContain("top: calc(100% + 10px);");
    expect(styles).toContain("right: 0;");
    expect(styles).not.toContain(".editor-v2-root .editor-preview-zoom-control");
  });

  it("shows delayed friendly tooltips for preview controls", () => {
    expect(editorSource).toContain(
      'data-tooltip={overlayPreviewEnabled\n              ? (isPreviewPlaying ? "정지" : "재생")',
    );
    expect(editorSource).toContain(
      'data-tooltip={isPreviewFullscreen ? "전체보기 종료" : "전체보기"}',
    );
    expect(styles).toContain(
      ".editor-v2-root .editor-preview-play-control:hover::after",
    );
    expect(styles).toContain("transition-delay: .5s;");
  });

  it("widens only the timeline and keeps horizontal scrolling local", () => {
    expect(styles).toContain(".editor-v2-root .editor-workspace-timeline");
    expect(styles).toContain(".editor-v2-root .editor-timeline-scroll-area");
    expect(styles).toContain("overflow-x: auto;");
    expect(styles).toContain(
      ".editor-v2-root .editor-filmstrip-wrap,\n.editor-v2-root .editor-overlay-timeline-lanes",
    );
    expect(styles).toContain(
      ".editor-v2-root .editor-timeline-zoom-control > span",
    );
  });

  it("preserves the visible timeline center while zooming", () => {
    expect(editorSource).toContain(
      "const editorTimelineScrollAreaRef = useRef<HTMLDivElement>(null)",
    );
    expect(editorSource).toContain(
      "scrollArea.scrollLeft + scrollArea.clientWidth / 2",
    );
    expect(editorSource).toContain(
      "center * scrollArea.scrollWidth - scrollArea.clientWidth / 2",
    );
    expect(editorSource).toContain("onChange={updateEditorTimelineZoom}");
    expect(editorSource).toContain(
      'ref={editorTimelineScrollAreaRef} className="editor-timeline-scroll-area"',
    );
  });

  it("keeps timeline zoom controls outside the horizontally scrolling layer", () => {
    expect(editorSource).toContain('className="editor-timeline-scroll-area"');
    expect(styles).toContain("position: absolute;");
    expect(styles).toContain("right: 32px;");
    expect(styles).toContain(
      ".editor-v2-root .editor-timeline-scroll-area::-webkit-scrollbar",
    );
  });
});
