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
      "setSelectedOverlay(editorTextSelection(textOverlay.id))",
    );
    expect(editorSource).toContain("seekCommentTimeline(Math.max(");
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

  it("keeps every new style under the v2 root", () => {
    const styles = source("./editor-v2.css");
    expect(styles).toContain(".editor-v2-root .editor-v2-text-tool-panel");
    expect(styles).toContain(".editor-v2-root .editor-v2-text-list-item");
  });
});
