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

  it("offers vertical position and size controls with a live preview", () => {
    expect(editorSource).toContain('aria-label="자막 세로 위치"');
    expect(editorSource).toContain('aria-label="자막 크기"');
    expect(editorSource).toContain("data-editor-caption-template-preview");
    expect(editorSource).toContain('spec.templateId === "pop"');
    expect(editorSource).toContain("실제 생성된 자막의 내용과 타이밍, 가로 중심은 고정됩니다");
    expect(editorSource).toContain("!captionTemplateEditorSpec && activeSubtitle");
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
