import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorSource = readFileSync(new URL("./template-editor.tsx", import.meta.url), "utf8");
const librarySource = readFileSync(new URL("./template-library.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const newPageSource = readFileSync(new URL("./new/page.tsx", import.meta.url), "utf8");
const editPageSource = readFileSync(new URL("./[templateId]/edit/page.tsx", import.meta.url), "utf8");
const previewSource = readFileSync(
  new URL("../../components/custom-template-canvas-preview.tsx", import.meta.url),
  "utf8",
);

describe("unified template subtitle access", () => {
  it("shows the stable public presets independently from paid editing access", () => {
    expect(pageSource).toContain("unifiedSubtitleCanaryEnabled = subtitleTemplateAccess.unifiedEnabled");
    expect(pageSource).toContain("getUnifiedTemplateSubtitlePublicPreviewAccess(db)");
    expect(librarySource).toContain("if (!unifiedSubtitlePreviewEnabled) return []");
    expect(librarySource).toContain("/?subtitleTemplate=${preset.variant}");
    expect(editorSource).toContain("unifiedSubtitleCanaryEnabled && isTemplateConfigV5(config)");
    expect(previewSource).toContain("showUnifiedSubtitle && isTemplateConfigV5(config)");
  });

  it("opens pop and highlight presets in the editor only for paid or issued accounts", () => {
    expect(librarySource).toContain('id: "subtitle-pop"');
    expect(librarySource).toContain('id: "subtitle-highlight"');
    expect(librarySource).toContain("authenticated && canUseCustomTemplates && unifiedSubtitleCanaryEnabled");
    expect(librarySource).toContain("/templates/new?preset=${preset.id}");
    expect(newPageSource).toContain("createUnifiedSubtitleTemplateConfig(subtitleVariant)");
    expect(newPageSource).toContain("if (!billingSupportsCustomTemplates(billing))");
    expect(newPageSource).toContain("if (subtitleVariant) redirect(`/?subtitleTemplate=${subtitleVariant}`)");
    expect(editPageSource).toContain("if (!billingSupportsCustomTemplates(billing)) redirect(\"/pricing\")");
  });

  it("offers the agreed saveable subtitle controls while fixing horizontal position", () => {
    expect(editorSource).toContain('subtitle: "자막"');
    expect(editorSource).toContain('aria-label="자막 폰트"');
    expect(editorSource).toContain('aria-label="후킹 제목 폰트"');
    expect(editorSource).toContain("max={120}");
    expect(editorSource).toContain("next.subtitle.x = TEMPLATE_CANVAS.width / 2");
    expect(editorSource).toContain("next.subtitle.accentColor = color");
    expect(editorSource).toContain("next.subtitle.visible = !next.subtitle.visible");
    expect(editorSource).not.toContain("어드민 카나리");
    expect(editorSource).not.toContain("직접 업로드 영상에 동일하게 적용");
    expect(librarySource).toContain(">자막 템플릿</span>");
  });
});
