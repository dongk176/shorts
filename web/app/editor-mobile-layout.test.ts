import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("editor mobile layout", () => {
  const editorSource = source("./shorts-app.tsx");
  const textTimelineSource = source("../components/editor-text-overlay-preview.tsx");
  const styles = source("./editor-v2.css");

  it("allows narrow and touch devices to use the editor", () => {
    expect(editorSource).not.toContain("mobileEditorBlocked");
    expect(editorSource).not.toContain("PC 전용 편집 기능");
    expect(editorSource).toContain('window.matchMedia("(max-width: 920px)")');
  });

  it("opens the existing control sheet from the mobile tool rail", () => {
    expect(editorSource).toContain("const toolAlreadyOpen = activeEditorSidebarTool === tool");
    expect(editorSource).toContain("setMobileControlsOpen(!toolAlreadyOpen)");
    expect(styles).toContain(".editor-v2-root .editor-tool-rail");
    expect(styles).toContain("overflow-x: auto;");
    expect(styles).toContain(
      "--editor-mobile-tool-height: calc(64px + env(safe-area-inset-bottom,0px));",
    );
  });

  it("opens the bottom sheet only from explicit navigation or editing", () => {
    expect(editorSource.match(/setMobileControlsOpen\(true\)/g)).toHaveLength(1);
    expect(editorSource).toContain("openMobileEditorControlsForSelection");
    expect(editorSource).toContain(
      'if (!window.matchMedia("(max-width: 640px)").matches) {',
    );
    expect(editorSource).toContain("setMobileControlsOpen(!toolAlreadyOpen)");
  });

  it("keeps the portrait preview at a fixed 9 by 16 size", () => {
    expect(styles).toContain("@media (max-width: 640px) and (orientation: portrait)");
    expect(styles).toContain("height: max(0px,calc(100% - 50px));");
    expect(styles).toContain("max-width: min(58vw,244px);");
    expect(styles).toContain("aspect-ratio: 9/16;");
    expect(styles).toContain("grid-template-rows: minmax(0,1fr) clamp(168px,28dvh,260px);");
  });

  it("reserves action-row space when the mobile viewport gets shorter", () => {
    expect(styles).toContain("max-height: max(0px,calc(100% - 50px));");
    expect(styles).toContain("min-height: 42px;");
    expect(styles).toContain("grid-template-rows: minmax(42px,1fr);");
  });

  it("keeps undo and redo available in the mobile header", () => {
    expect(editorSource).toContain('className="editor-mobile-history-actions"');
    expect(styles).toContain(".editor-v2-root .editor-mobile-history-actions");
  });

  it("uses a compact brand header without repeating the project title", () => {
    expect(editorSource).toContain(
      '<span className="editor-apply-label-mobile">영상에 적용</span>',
    );
    expect(styles).toContain(".editor-v2-root .editor-header-project {");
    expect(styles).toContain("background: #ff715e;");
  });

  it("hides desktop-only controls beside the mobile preview", () => {
    expect(styles).toContain(".editor-v2-root .editor-overlay-size-control,");
    expect(styles).toContain(".editor-v2-root .editor-layer-order-control {");
  });

  it("does not leave play and pause tooltips on touch screens", () => {
    expect(styles).toContain(
      ".editor-v2-root .editor-preview-play-control::after,",
    );
    expect(styles).toContain("content: none;");
  });

  it("centers the action row between preview and layout without overlaying video", () => {
    expect(editorSource).toContain('className="editor-preview-mobile-actions"');
    expect(styles).toContain(".editor-v2-root .editor-preview-mobile-actions {");
    expect(styles).toContain("flex: 1 1 0;");
    expect(styles).toContain(
      "grid-template-columns: minmax(0,1fr) auto minmax(0,1fr);",
    );
    expect(styles).toContain("position: static;");
    expect(styles).toContain("grid-column: 2;");
    expect(styles).toContain(".editor-v2-root .editor-preview-time-group {");
    expect(styles).toContain("display: none;");
  });

  it("optically raises the mobile tool icons and labels", () => {
    expect(styles).toContain("transform: translateY(-3px);");
  });

  it("keeps the video track fixed while layout tracks scroll vertically", () => {
    expect(styles).toContain("grid-template-rows: auto minmax(0,1fr);");
    expect(styles).toContain(
      ".editor-v2-root .editor-workspace-timeline:not(.editor-comment-only-panel) .editor-overlay-timeline-lanes",
    );
    expect(styles).toContain("overscroll-behavior-y: contain;");
    expect(styles).toContain("touch-action: pan-y;");
    expect(styles).toContain("scrollbar-width: none;");
    expect(styles).toContain("height: calc(100% - 10px);");
  });

  it("pans layout tracks horizontally and selects only from a stationary tap", () => {
    expect(styles).toContain("touch-action: pan-x pan-y;");
    expect(editorSource).toContain(
      'active.adjustment === "move" && event.pointerType !== "mouse"',
    );
    expect(textTimelineSource).toContain(
      'active.adjustment === "move" && event.pointerType !== "mouse"',
    );
    expect(textTimelineSource).not.toContain("onClick={onSelect}");
    expect(textTimelineSource).toContain(
      "if (active.moved || event.type !== \"pointerup\")",
    );
  });

  it("uses one horizontal range for video and every layout track", () => {
    expect(editorSource).toContain('className="editor-timeline-shared-content"');
    expect(editorSource).toContain(
      'className="editor-timeline-shared-content"\n            style={editorTimelineZoomStyle}',
    );
    expect(editorSource).not.toContain(
      'className="editor-filmstrip-wrap" style={editorTimelineZoomStyle}',
    );
    expect(styles).toContain(
      ".editor-v2-root .editor-timeline-shared-content",
    );
    expect(styles).toContain("grid-template-rows: auto minmax(0,1fr);");
  });

  it("updates resize gestures continuously without delayed width animation", () => {
    expect(editorSource).toContain("const EDITOR_VIDEO_SIZE_SNAP_THRESHOLD_PX = 4;");
    expect(editorSource).toContain("const percentage = minimumPercentage + ratio * percentageRange;");
    expect(editorSource).toContain("window.requestAnimationFrame(flushScale)");
    expect(editorSource).toContain("updateSize(finishEvent.clientX, finishEvent.clientY)");
    expect(editorSource).toContain("step={1}");
    expect(styles).toContain("transition: filter .18s,box-shadow .18s;");
  });

  it("maps every timeline resize handle to the same full-width scale", () => {
    expect(editorSource).toContain("timelinePointerDeltaSeconds(");
    expect(editorSource).toContain(
      "clientX - startClientX,\n        trackWidth,\n        timelineDuration,",
    );
    expect(editorSource).not.toContain("* initialDuration;");
    expect(textTimelineSource).toContain(
      "timelinePointerDeltaSeconds(distance, active.width, safeDuration)",
    );
  });

  it("pans the mobile video timeline and seeks only from a tap", () => {
    expect(editorSource).toContain("mobileTimelinePointerRef");
    expect(editorSource).toContain(
      'event.type === "pointerup" && !mobilePointer.moved',
    );
    expect(styles).toContain("touch-action: pan-x;");
    expect(styles).toContain("-webkit-overflow-scrolling: touch;");
  });

  it("starts the mobile timeline at two hundred percent zoom", () => {
    expect(editorSource).toContain(
      "const EDITOR_TIMELINE_MOBILE_DEFAULT_ZOOM = 2;",
    );
    expect(editorSource).toContain(
      "setEditorTimelineZoom(EDITOR_TIMELINE_MOBILE_DEFAULT_ZOOM)",
    );
  });

  it("removes the filler shadow above the bottom navigation", () => {
    expect(styles).toContain("padding: 0 12px;");
    expect(styles).toContain("box-shadow: none;");
  });

  it("separates bottom-sheet content from its header", () => {
    expect(styles).toContain("padding: 16px 16px 24px;");
  });

  it("uses compact mobile playback, comment, and split actions", () => {
    expect(styles).toContain("min-height: 36px;");
    expect(styles).toContain("width: 36px;");
    expect(styles).toContain("font-size: 12px;");
    expect(styles).toContain("font-size: 17px;");
  });

  it("opens layout controls from a double click", () => {
    expect(editorSource).toContain("onDoubleClickCapture={(event) => {");
    expect(editorSource).toContain(
      'openMobileEditorControlsForSelection("comment")',
    );
    expect(textTimelineSource).toContain("onDoubleClick={(event) => {");
    expect(textTimelineSource).toContain("onEdit();");
  });

  it("opens text and hooking-title sheets from a mobile double tap", () => {
    expect(editorSource).toContain("mobileOverlayActivationRef");
    expect(editorSource).toContain("openMobileEditorControlsFromDoubleTap");
    expect(editorSource).toContain(
      '|| layer === "channel"',
    );
    expect(editorSource).toContain("editorTextSelection(id),");
    expect(textTimelineSource).toContain("lastTouchActivationRef");
    expect(textTimelineSource).toContain('event.pointerType !== "mouse"');
    expect(textTimelineSource).toContain("event.timeStamp - previousActivation <= 450");
  });

  it("opens the selected preview comment sheet from a mobile double tap", () => {
    expect(editorSource).toContain(
      '|| (layer === "comment" && commentId)',
    );
    expect(editorSource).toContain("setSelectedTimelineCommentId(layer === \"comment\" ? commentId || null : null)");
    expect(editorSource).toContain("openMobileEditorControlsFromDoubleTap(\n            layer,");
  });

  it("opens channel controls from a preview double click or mobile double tap", () => {
    expect(editorSource).toContain('layer === "channel"');
    expect(editorSource).toContain('|| layer === "channel"');
    expect(editorSource).toContain("openMobileEditorControlsFromDoubleTap(\n            layer,");
  });

  it("replaces the mobile tool rail with edit and delete actions", () => {
    expect(editorSource).toContain("editor-mobile-selection-actions");
    expect(editorSource).toContain("deleteSelectedMobileLayout");
    expect(editorSource).toContain("수정");
    expect(editorSource).toContain("삭제");
    expect(editorSource).toContain("선택 해제");
    expect(styles).toContain(
      "grid-template-columns: repeat(3,minmax(0,1fr));",
    );
    expect(styles).toContain(
      "grid-template-columns: repeat(4,minmax(0,1fr));",
    );
    expect(styles).toContain(
      ".editor-v2-root .editor-tool-rail .editor-mobile-selection-actions button",
    );
    expect(styles).toContain(
      ".editor-v2-root .editor-tool-rail.has-mobile-selection .editor-tool-rail-buttons",
    );
  });

  it("adds an equal-width comment content action for selected comments", () => {
    expect(editorSource).toContain("editSelectedCommentContent");
    expect(editorSource).toContain("댓글 내용 수정");
    expect(editorSource).toContain(
      "requestCommentTextEdit(selectedTimelineCommentId, false)",
    );
  });

  it("edits the double-clicked comment inside the comment bottom sheet", () => {
    expect(editorSource).toContain("const selectedTimelineComment =");
    expect(editorSource).toContain('className="editor-selected-comment-setting"');
    expect(editorSource).toContain('aria-label="선택한 댓글 내용 수정"');
    expect(editorSource).toContain("onFocus={beginEditorCommentTextInteraction}");
    expect(editorSource).toContain("onBlur={finishEditorCommentTextInteraction}");
    expect(editorSource).toContain("selectedTimelineComment.id,");
    expect(styles).toContain(
      ".editor-v2-root .editor-selected-comment-setting textarea",
    );
  });

  it("does not select layout tracks when a vertical scroll starts", () => {
    expect(editorSource).toContain("Math.abs(verticalDistance) > Math.abs(distance)");
    expect(editorSource).toContain("rangeEditStarted: false");
    expect(textTimelineSource).not.toContain("onPointerDownCapture={onSelect}");
    expect(textTimelineSource).not.toContain("onClick={onSelect}");
    expect(textTimelineSource).toContain(
      "Math.abs(verticalDistance) > Math.abs(distance)",
    );
  });
});
