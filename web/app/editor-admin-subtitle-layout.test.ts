import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("admin editor subtitle layout", () => {
  const editorSource = source("./shorts-app.tsx");

  it("shows the subtitle tool only for word-timed capable v3 releases", () => {
    expect(editorSource).toContain(
      "subtitleEditingReleaseEnabled(\n    editorRelease,\n  )",
    );
    expect(editorSource).toContain('{ id: "subtitle", label: "자막" }');
    expect(editorSource).toContain(
      "const adminSubtitleEditingEnabled = adminSubtitleLayoutEnabled\n    && wordTimedSubtitlesAvailable",
    );
    expect(editorSource).toContain(
      'tool.id !== "subtitle"\n              || adminSubtitleEditingEnabled',
    );
    expect(editorSource).toContain(
      "wordTimedSubtitlesAvailable={project.wordTimedSubtitlesAvailable}",
    );
    expect(editorSource).toContain("const toggleEditorSubtitles = useCallback(() => {");
    expect(editorSource).not.toContain(
      "const toggleEditorSubtitles = useCallback(() => {\n    if (!captionTemplateEditorSpec) return;",
    );
    expect(editorSource).toContain('aria-label={subtitlesEnabled ? "자막 끄기" : "자막 켜기"}');
    expect(editorSource).toContain("subtitlesEnabledRef.current = enabled");
    expect(editorSource).toContain("subtitlesEnabled: subtitlesEnabledRef.current");
    expect(editorSource).toContain("createEditorHighlightCaptionSpec(");
    expect(editorSource).toContain("const editableCaptionSourceSpec = captionTemplateEditorSpec");
    expect(editorSource).toContain("기존 전사 자막이");
    expect(editorSource).toContain(
      "!overlayPreviewEnabled && !captionTemplateEditorSpec",
    );
    expect(editorSource).toContain(
      "const subtitleEditorUnavailable = Boolean(",
    );
    expect(editorSource).toContain("|| !item.captionRenderSpec");
    const editPageSource = source("./projects/[projectNumber]/edit/[shortId]/page.tsx");
    expect(editPageSource).toContain(
      "!parseCaptionRenderSpec(subtitleTemplateShort.captionRenderSpec)",
    );
  });

  it("offers caption copy, color, vertical drag and size controls with a live preview", () => {
    expect(editorSource).toContain('aria-label="자막 세로 위치"');
    expect(editorSource).toContain('aria-label="자막 크기"');
    expect(editorSource).toContain("data-editor-caption-template-preview");
    expect(editorSource).toContain('aria-label={`자막 포인트 색상 ${option.name}`}');
    expect(editorSource).toContain('title="드래그해서 이동 · 더블클릭해서 자막 수정"');
    expect(editorSource).toContain("onEditStart={beginEditorCaptionTextEdit}");
    expect(editorSource).toContain("resolveEditorCaptionTextEditTarget(");
    expect(editorSource).toContain("updateEditorCaptionCueText(");
    expect(editorSource).not.toContain(
      "editableCaptionSourceSpec.cues[draft.cueIndex]",
    );
    expect(editorSource).toContain("onPointerDown={beginEditorSubtitleDrag}");
    expect(editorSource).toContain("subtitleOffsetBounds.max");
    expect(editorSource).toContain('spec.templateId === "pop"');
    expect(editorSource).toContain("retimeCaptionRenderSpecForEditor");
    expect(editorSource).toContain(
      "음성보다 {editableCaptionSourceSpec.timingLeadFrames ?? SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES}프레임 먼저 표시",
    );
    expect(editorSource).toContain("* CAPTION_ASS_PREVIEW_FONT_SCALE");
    expect(editorSource).toContain("spec.style.outlineWidth * layout.scale * 2");
    expect(editorSource).toContain("subtitleLayout.cueEdits");
    expect(editorSource).toContain("document.fonts.load");
    expect(editorSource).not.toContain("visibleEditedWords");
    expect(editorSource).toContain("(currentFrameFloat - event.startFrame) / easeFrames");
    expect(editorSource).toContain('!overlayPreviewEnabled && templateId !== "comment-capture"');
    expect(editorSource).toContain("!editableCaptionSourceSpec && activeSubtitle");
    expect(editorSource).toContain("captionTemplatePreviewSnapshot.layout.video");
    expect(editorSource).toContain("panelRect={captionTemplatePreviewSnapshot?.layout.title}");
    expect(editorSource).toContain("<CaptionTemplateEditorChannel");
  });

  it("sends a subtitle layout only through an enabled v3 release", () => {
    expect(editorSource).toContain(
      "? editorDocumentSubtitleLayout",
    );
    const routeSource = source("./api/shorts/[shortId]/apply-edit/route.ts");
    expect(routeSource).toContain("!subtitleEditingReleaseEnabled(release)");
    expect(routeSource).toContain("EDITOR_SUBTITLE_EDITING_DISABLED");
    expect(routeSource).toContain("s.caption_render_spec");
    expect(routeSource).toContain("CAPTION_RENDER_SPEC_MISSING");
    expect(routeSource).toContain("word_timed_subtitles_available");
    expect(routeSource).toContain("EDITOR_WORD_TIMED_SUBTITLES_REQUIRED");
  });
});
