import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const editorStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

describe("editor direct text editing", () => {
  it("anchors the comment editor above the clicked timeline item", () => {
    expect(editorSource).toContain("lastCommentActivationRef");
    expect(editorSource).toContain(
      "if (!active.captureTarget.hasPointerCapture(active.pointerId))",
    );
    expect(editorSource).toContain(
      "if (comment) openCommentTextEditor(comment, active.captureTarget);",
    );
    expect(editorSource).toContain("editingCommentAnchorRef");
    expect(editorSource).toContain("createPortal(");
    expect(editorSource).toContain("document.body");
    expect(editorStyles).toContain(
      ".editor-comment-popover { position: fixed;",
    );
    expect(editorStyles).toContain(
      "transform: translate(-50%,-100%);",
    );
    expect(editorStyles).not.toContain(
      ".editor-comment-popover { position: absolute;",
    );
  });

  it("offers direct editing from preview comments and active subtitles", () => {
    expect(editorSource).toContain('title="더블클릭해서 댓글 수정"');
    expect(editorSource).toContain('title="더블클릭해서 자막 수정"');
    expect(editorSource).toContain('aria-label="현재 자막 수정"');
  });
});
