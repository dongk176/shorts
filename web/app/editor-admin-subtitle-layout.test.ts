import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("admin editor subtitle layout", () => {
  const editorSource = source("./shorts-app.tsx");

  it("shows the tool only for an administrator canary v3 caption template", () => {
    expect(editorSource).toContain(
      'editorRelease.channel === "canary"\n    && editorRelease.documentVersion === 3',
    );
    expect(editorSource).toContain('{ id: "subtitle", label: "자막" }');
    expect(editorSource).toContain(
      'tool.id !== "subtitle"\n              || (\n                captionTemplateEditorSpec\n                && subtitlesEnabled',
    );
    expect(editorSource).toContain(
      "item.subtitleTemplateId && !adminSubtitleLayoutEnabled",
    );
    const editPageSource = source("./projects/[projectNumber]/edit/[shortId]/page.tsx");
    expect(editPageSource).toContain(
      "if (subtitleTemplateShortRows[0] && !adminSubtitleLayoutEnabled) notFound();",
    );
  });

  it("offers caption copy, color, vertical drag and size controls with a live preview", () => {
    expect(editorSource).toContain('aria-label="자막 세로 위치"');
    expect(editorSource).toContain('aria-label="자막 크기"');
    expect(editorSource).toContain("data-editor-caption-template-preview");
    expect(editorSource).toContain('aria-label={`자막 포인트 색상 ${option.name}`}');
    expect(editorSource).toContain('title="드래그해서 이동 · 더블클릭해서 자막 수정"');
    expect(editorSource).toContain("onEditStart={beginEditorCaptionTextEdit}");
    expect(editorSource).toContain("onPointerDown={beginEditorSubtitleDrag}");
    expect(editorSource).toContain("subtitleOffsetBounds.max");
    expect(editorSource).toContain('spec.templateId === "pop"');
    expect(editorSource).toContain("retimeCaptionRenderSpecForEditor");
    expect(editorSource).toContain(
      "음성보다 {captionTemplateEditorSpec.timingLeadFrames ?? SUBTITLE_TEMPLATE_TIMING_LEAD_FRAMES}프레임 먼저 표시",
    );
    expect(editorSource).toContain("* CAPTION_ASS_PREVIEW_FONT_SCALE");
    expect(editorSource).toContain("spec.style.outlineWidth * layout.scale * 2");
    expect(editorSource).toContain("subtitleLayout.cueEdits");
    expect(editorSource).toContain("document.fonts.load");
    expect(editorSource).not.toContain("visibleEditedWords");
    expect(editorSource).toContain("(currentFrameFloat - event.startFrame) / easeFrames");
    expect(editorSource).toContain('!overlayPreviewEnabled && templateId !== "comment-capture"');
    expect(editorSource).toContain("!captionTemplateEditorSpec && activeSubtitle");
    expect(editorSource).toContain("captionTemplatePreviewSnapshot.layout.video");
    expect(editorSource).toContain("panelRect={captionTemplatePreviewSnapshot?.layout.title}");
    expect(editorSource).toContain("<CaptionTemplateEditorChannel");
  });

  it("sends a subtitle layout only through the admin v3 snapshot", () => {
    expect(editorSource).toContain(
      "adminSubtitleLayoutEnabled ? subtitleLayout : undefined",
    );
    const routeSource = source("./api/shorts/[shortId]/apply-edit/route.ts");
    expect(routeSource).toContain('release.channel !== "canary"');
    expect(routeSource).toContain("EDITOR_SUBTITLE_LAYOUT_ADMIN_ONLY");
    expect(routeSource).toContain("s.caption_render_spec");
    expect(routeSource).toContain("CAPTION_RENDER_SPEC_MISSING");
  });
});
