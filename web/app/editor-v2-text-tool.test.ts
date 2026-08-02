import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("editor v2 text tool", () => {
  const editorSource = source("./shorts-app.tsx");

  it("adds a dedicated text item to the v2 tool rail", () => {
    expect(editorSource).toContain('{ id: "text", label: "텍스트" }');
    expect(editorSource).toContain('aria-label="텍스트 설정"');
    expect(editorSource).toContain('className="editor-v2-text-add"');
  });

  it("keeps preview, timeline, and sidebar text selection synchronized", () => {
    expect(editorSource).toContain('setActiveEditorSidebarTool("text")');
    expect(editorSource).toContain(
      "onClick={() => selectEditorTextFromSidebar(textOverlay)}",
    );
    expect(editorSource).toContain(
      "setSelectedOverlay(selection)",
    );
    expect(editorSource).toContain("seekCommentTimeline(Math.max(");
    expect(editorSource).toContain(
      "setExpandedEditorTextId(selectedEditorTextId(selectedOverlay))",
    );
  });

  it("expands text settings below the selected item and collapses on repeat", () => {
    expect(editorSource).toContain(
      "selectedOverlay === selection\n      && expandedEditorTextId === textOverlay.id",
    );
    expect(editorSource).toContain("setExpandedEditorTextId(null)");
    expect(editorSource).toContain("aria-expanded={expanded}");
    expect(editorSource).toContain(
      "{expanded && <div\n                      id={detailId}\n                      className=\"editor-v2-text-accordion-detail\"",
    );
    const styles = source("./editor-v2.css");
    expect(styles).toContain(
      ".editor-v2-root .editor-v2-text-accordion-detail",
    );
  });

  it("moves text creation into the text panel", () => {
    const quickActions = editorSource.slice(
      editorSource.indexOf("editor-preview-quick-actions"),
      editorSource.indexOf("{videoCuttingEnabled", editorSource.indexOf("editor-preview-quick-actions")),
    );
    expect(quickActions).toContain("+ 댓글");
    expect(quickActions).not.toContain("+ 텍스트");
    expect(editorSource).toContain("선택한 텍스트 삭제");
  });

  it("asks in a modal before applying any changed font to every selectable text", () => {
    expect(editorSource).toContain("function EditorFontApplyDialog({");
    expect(editorSource).toContain("모든 텍스트에 적용할까요?");
    expect(editorSource).toContain("현재 텍스트만");
    expect(editorSource).toContain("모두 적용");
    expect(editorSource).toContain("applyEditorFontToSelectableText(");
    expect(editorSource).toContain("onChange={updateSelectedEditorTextFont}");
    expect(editorSource).toContain(
      'onChange={(fontId) => updateEditorFont("title", fontId)}',
    );
    expect(editorSource).toContain(
      'onChange={(fontId) => updateEditorFont("channel", fontId)}',
    );
  });

  it("lets a hidden or visible channel layer be toggled from channel settings", () => {
    expect(editorSource).toContain("const toggleEditorChannelVisibility = () => {");
    expect(editorSource).toContain('className="editor-channel-visibility-toggle"');
    expect(editorSource).toContain('aria-pressed={renderOverlayLayout.visible.channel}');
    expect(editorSource).toContain('channel: visible');
    const styles = source("./editor-v2.css");
    expect(styles).toContain(
      ".editor-v2-root .editor-channel-visibility-toggle",
    );
    expect(editorSource).toContain("forceVisible={overlayPreviewEnabled}");
    expect(editorSource).toContain(
      'selectedOverlay === "channel" ? "맨앞 고정" : "레이어 순서"',
    );
  });

  it("preserves title color ranges while either title line is edited", () => {
    expect(editorSource).toContain("const nextTitleTextStyles = overlayPreviewEnabled");
    expect(editorSource).toContain("rebaseTitleTextStyles(");
  });

  it("opens the hook-title detail sidebar when the preview title is selected", () => {
    expect(editorSource).toContain('selectedOverlay !== "title"');
    expect(editorSource).toContain('setActiveEditorSidebarTool("title")');
    expect(editorSource).toContain("setDesktopSidebarOpen(true)");
  });

  it("toggles the text detail panel from the fixed tool rail", () => {
    expect(editorSource).toContain('if (tool === "text")');
    expect(editorSource).toContain(
      "setDesktopSidebarOpen((current) => !current)",
    );
    expect(editorSource).toContain(
      "activeEditorSidebarTool === tool.id\n                && desktopSidebarOpen",
    );
  });

  it("shows comment copy and removes v2 timeline card chrome", () => {
    expect(editorSource).toContain("showCommentText={overlayPreviewEnabled}");
    expect(editorSource).toContain(
      "const visibleLabel = showCommentText ? commentText : fallbackLabel",
    );
    const styles = source("./editor-v2.css");
    expect(styles).toContain(
      ".editor-v2-root .editor-comment-timeline-panel",
    );
    expect(styles).toContain(
      ".editor-v2-root .editor-text-timeline-panel.is-selected",
    );
    expect(styles).toContain(
      ".editor-v2-root .editor-text-timeline-label",
    );
    expect(styles).toContain("font-size: 12px;");
    expect(styles).toContain("margin-top: 4px;");
  });

  it("keeps every new style under the v2 root", () => {
    const styles = source("./editor-v2.css");
    expect(styles).toContain(".editor-v2-root .editor-v2-text-tool-panel");
    expect(styles).toContain(".editor-v2-root .editor-v2-text-list-item");
  });
});
