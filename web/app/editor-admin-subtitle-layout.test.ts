import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("admin editor subtitle layout", () => {
  const editorSource = source("./shorts-app.tsx");

  it("shows the canary subtitle tool and fails closed without an authoritative caption spec", () => {
    expect(editorSource).toContain(
      "subtitleEditingReleaseEnabled(\n    editorRelease,\n  )",
    );
    expect(editorSource).toContain('{ id: "subtitle", label: "자막" }');
    expect(editorSource).toContain(
      "const adminSubtitleEditingEnabled = adminSubtitleLayoutEnabled\n    && (wordTimedSubtitlesAvailable || Boolean(captionTemplateEditorSpec))",
    );
    expect(editorSource).toContain(
      'tool.id !== "subtitle"\n              || subtitleToolVisible',
    );
    expect(editorSource).toContain(
      "wordTimedSubtitlesAvailable={item.wordTimedSubtitlesAvailable}",
    );
    expect(editorSource).toContain("const toggleEditorSubtitles = useCallback(() => {");
    expect(editorSource).toContain(
      "if (!subtitlesEnabledRef.current && !editableCaptionSourceSpec) return;",
    );
    expect(editorSource).toContain('aria-label={subtitlesEnabled ? "자막 끄기" : "자막 켜기"}');
    expect(editorSource).toContain(
      "disabled={unifiedSubtitleLayoutEnabled",
    );
    expect(editorSource).toContain("subtitlesEnabledRef.current = enabled");
    expect(editorSource).toContain("subtitlesEnabled: subtitlesEnabledRef.current");
    expect(editorSource).toContain("createEditorHighlightCaptionSpec(");
    expect(editorSource).toContain("const editableCaptionSourceSpec = captionTemplateEditorSpec");
    expect(editorSource).toContain("유효한 단어 타이밍이 없어 새 자막을 켤 수 없습니다");
    expect(editorSource).toContain(
      "!overlayPreviewEnabled && !captionTemplateEditorSpec",
    );
    expect(editorSource).toContain(
      "const subtitleEditorUnavailable = Boolean(",
    );
    expect(editorSource).toContain(
      "!adminSubtitleLayoutEnabled\n                  || !item.captionRenderSpec",
    );
    const editPageSource = source("./projects/[projectNumber]/edit/[shortId]/page.tsx");
    expect(editPageSource).toContain(
      "isUnifiedTemplateSubtitleSnapshot(",
    );
  });

  it("offers caption copy, color, vertical drag and size controls with a live preview", () => {
    expect(editorSource).toContain('aria-label="자막 세로 위치"');
    expect(editorSource).toContain('aria-label="자막 크기"');
    expect(editorSource).toContain("data-editor-caption-template-preview");
    expect(editorSource).toContain('aria-label={`자막 포인트 색상 ${option.name}`}');
    expect(editorSource).toContain('aria-label={`자막 일반 글자색 ${option.name}`}');
    expect(editorSource).toContain('"드래그해서 이동 · 더블클릭해서 자막 수정"');
    expect(editorSource).toContain("onEditStart={beginEditorCaptionTextEdit}");
    expect(editorSource).toContain(
      "textEditingEnabled={captionTextEditingEnabled}",
    );
    expect(editorSource).toContain(
      "const dynamicWordTimedSubtitleEditing = unifiedSubtitleLayoutEnabled",
    );
    expect(editorSource).toContain(
      "정확한 자막 구간이 저장되지 않은 영상에서는 문구 편집을 지원하지 않습니다.",
    );
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
    expect(editorSource).toContain("? spec.font.metrics.cssToAssScale");
    expect(editorSource).toContain(": CAPTION_ASS_PREVIEW_FONT_SCALE;");
    expect(editorSource).toContain("spec.style.outlineWidth * captionScale * 2");
    expect(editorSource).toContain("min={24}");
    expect(editorSource).toContain("max={120}");
    expect(editorSource).toContain("subtitleLayout.cueEdits");
    expect(editorSource).toContain("document.fonts.load");
    expect(editorSource).toContain(
      "const exactCaptionPreview = positionedWordsV4Enabled\n"
      + "      && editorRenderSpecVersion === EDITOR_RENDER_SPEC_V4_VERSION;",
    );
    expect(editorSource).toContain(
      "ensureEditorFontFaceV4Loaded(\n          resolveEditorFontFaceV4(captionFontId, \"title\")",
    );
    expect(editorSource).toContain(
      "editableCaptionSourceSpec.schemaVersion === 4\n          ? undefined",
    );
    expect(editorSource).toContain(
      "subtitlesEnabled\n          && editableCaptionSourceSpec?.schemaVersion === 4",
    );
    expect(editorSource).not.toContain("visibleEditedWords");
    expect(editorSource).toContain("(currentFrameFloat - event.startFrame) / easeFrames");
    expect(editorSource).toContain('className="inline-block"');
    expect(editorSource).toContain('wordIndex > 0 && word.spaceBefore ? " " : null');
    expect(editorSource).toContain(
      "transformedX(spec.safeArea.x + spec.safeArea.width / 2)",
    );
    expect(editorSource).toContain(
      "const positionedV4Boxes = captionV4PositionedWordBoxes(",
    );
    expect(editorSource).toContain(
      "const centerX = transformedX(position.centerX);",
    );
    const legacyPopStart = editorSource.indexOf(': spec.templateId === "pop"');
    const legacyPopEnd = editorSource.indexOf(
      '\n      : <span\n        role="button"',
      legacyPopStart,
    );
    const legacyPopBranch = editorSource.slice(legacyPopStart, legacyPopEnd);
    expect(legacyPopStart).toBeGreaterThan(-1);
    expect(legacyPopEnd).toBeGreaterThan(legacyPopStart);
    expect(legacyPopBranch).not.toContain("position.centerX");
    expect(editorSource).toContain('!overlayPreviewEnabled && templateId !== "comment-capture"');
    expect(editorSource).toContain("!editableCaptionSourceSpec && activeSubtitle");
    expect(editorSource).toContain("captionTemplatePreviewSnapshot.layout.video");
    expect(editorSource).toContain("panelRect={captionTemplatePreviewSnapshot?.layout.title}");
    expect(editorSource).toContain("<CaptionTemplateEditorChannel");
  });

  it("sends a subtitle layout through an enabled v3 or v4 release", () => {
    expect(editorSource).toContain(
      "? editorDocumentSubtitleLayout",
    );
    expect(editorSource).toContain(
      "const editorRenderSpecVersion = editorRenderSpecVersionForRelease(\n    editorRelease,\n  )",
    );
    expect(editorSource).toContain(
      "const fullSubtitleStyleEditingEnabled = unifiedSubtitleLayoutEnabled\n    && (\n      editorRenderSpecVersion === 3\n      || editorRenderSpecVersion === EDITOR_RENDER_SPEC_V4_VERSION\n    )",
    );
    expect(editorSource).toContain(
      "editorRenderSpecVersion === EDITOR_RENDER_SPEC_V4_VERSION\n        ? 3\n        : editorRenderSpecVersion,",
    );
    expect(editorSource).toContain(
      "preserveV4TitleHorizontalOffset,\n    );",
    );
    expect(editorSource).toContain(
      "savedEditorDocument.renderSpec.version === EDITOR_RENDER_SPEC_V4_VERSION\n"
      + "      ? savedEditorDocument.renderSpec",
    );
    expect(editorSource).toContain(
      "const preserveV4TitleHorizontalOffset =\n"
      + "    editorRenderSpecVersion === EDITOR_RENDER_SPEC_V4_VERSION\n"
      + "    || initialRenderSpec?.version === EDITOR_RENDER_SPEC_V4_VERSION;",
    );
    const routeSource = source("./api/shorts/[shortId]/apply-edit/route.ts");
    expect(routeSource).toContain("!subtitleEditingReleaseEnabled(release)");
    expect(routeSource).toContain("EDITOR_SUBTITLE_EDITING_DISABLED");
    expect(routeSource).toContain("!editorReleaseSupportsRenderSpecV3(release)");
    expect(routeSource).toContain("EDITOR_RENDER_SPEC_UNSUPPORTED");
    expect(routeSource).toContain("s.caption_render_spec");
    expect(routeSource).toContain("CAPTION_RENDER_SPEC_MISSING");
    expect(routeSource).toContain("word_timed_subtitles_available");
    expect(routeSource).toContain("EDITOR_WORD_TIMED_SUBTITLES_REQUIRED");
    expect(routeSource).toContain(
      "EDITOR_DYNAMIC_CAPTION_TEXT_EDIT_UNSUPPORTED",
    );
    expect(routeSource).toContain("db.json(requestedClipWindows)");
    expect(routeSource).toContain("clip->'sourceStartSeconds'");
    expect(routeSource).toContain("!existing.subtitlesEnabled");
  });
});
