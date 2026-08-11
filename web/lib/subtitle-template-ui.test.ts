import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const subtitleTemplatesSource = readFileSync(
  new URL("./subtitle-templates.ts", import.meta.url),
  "utf8",
);
const editPageSource = readFileSync(
  new URL("../app/projects/[projectNumber]/edit/[shortId]/page.tsx", import.meta.url),
  "utf8",
);
const projectPageSource = readFileSync(
  new URL("../app/projects/[projectNumber]/page.tsx", import.meta.url),
  "utf8",
);

describe("subtitle template UI isolation", () => {
  it("mounts the test cards only behind the server capability", () => {
    expect(shortsAppSource).toContain("{subtitleTemplateSelectionEnabled && (");
    expect(shortsAppSource).not.toContain("자막 템플릿 · 테스트");
    expect(shortsAppSource).toContain('aria-label="템플릿 선택 레일"');
    expect(shortsAppSource).toContain("snap-x snap-mandatory");
    expect(shortsAppSource).toContain("overflow-x-auto");
    expect(shortsAppSource).not.toContain("mt-4 grid grid-cols-2");
    expect(subtitleTemplatesSource).not.toContain("자막 기본형");
    expect(subtitleTemplatesSource).toContain("자막 강조형");
    expect(subtitleTemplatesSource).toContain("자막 팝형");
    expect(subtitleTemplatesSource).not.toContain("자막 강조형 · 중앙");
    expect(subtitleTemplatesSource).not.toContain("자막 팝형 · 중앙");
    expect(shortsAppSource).toContain('aria-label="자막 위치"');
    expect(shortsAppSource).toContain('aria-label="자막 위치 선택"');
    expect(shortsAppSource).toContain("leadingFavoriteCards.map(renderFavoriteCard)");
    expect(shortsAppSource.indexOf("leadingFavoriteCards.map(renderFavoriteCard)"))
      .toBeLessThan(shortsAppSource.indexOf("subtitleTemplateOptions.map"));
    expect(shortsAppSource.indexOf("subtitleTemplateOptions.map"))
      .toBeLessThan(shortsAppSource.indexOf("remainingFavoriteCards.map(renderFavoriteCard)"));
    expect(shortsAppSource).not.toContain('id === "basic"');
    expect(shortsAppSource).toContain("SUBTITLE_TEMPLATE_BRAND_COLOR");
    expect(shortsAppSource).toContain("canvasCqw(snapshot.title.fontSizePx)");
    expect(shortsAppSource).toContain("canvasCqw(snapshot.font.sizePx)");
    expect(shortsAppSource).toContain("canvasCqw(snapshot.wordGapPx)");
    expect(shortsAppSource).toContain("snapshot.title.secondLineColor");
    expect(shortsAppSource).toContain("brandColorSelectionEnabled");
    expect(shortsAppSource).toContain("<BrandColorPicker");
    expect(shortsAppSource).toContain("template-picker-rail");
    expect(shortsAppSource).toContain("이게 바로 ");
    expect(shortsAppSource).not.toContain("이게 바로 ");
    expect(shortsAppSource).toContain(">자막입니다</span>");
    expect(shortsAppSource).not.toContain("지금 이 순간을 놓치지 마세요");
    expect(shortsAppSource).not.toContain('whitespace-nowrap text-[9px]');
  });

  it("keeps creation simple by using the default subtitle font", () => {
    expect(shortsAppSource).toContain(
      "...(subtitleTemplateSelectionEnabled && subtitleTemplateId ? { subtitleTemplateId, subtitleCaptionPlacement } : {})",
    );
    expect(shortsAppSource).toContain("fontId={DEFAULT_EDITOR_FONT_ID}");
    expect(shortsAppSource).not.toContain("subtitleFontId");
    expect(shortsAppSource).not.toContain('aria-label="자막 글씨체"');
    expect(shortsAppSource).toContain(
      "...(brandColorSelectionEnabled && !customTemplateId ? { brandColor } : {})",
    );
  });

  it("keeps generated-caption editing behind the release capability", () => {
    expect(shortsAppSource).toContain('setTemplateId("dark-minimal")');
    expect(shortsAppSource).toContain(
      "현재 편집기 릴리스에서는 이 자막을 편집할 수 없어요.",
    );
    expect(shortsAppSource).toContain(
      "const subtitleEditorUnavailable = Boolean(",
    );
    expect(shortsAppSource).toContain("|| !item.captionRenderSpec");
    expect(projectPageSource).toContain(
      "subtitleEditingReleaseEnabled",
    );
    expect(projectPageSource).toContain(
      "adminSubtitleLayoutEnabled={adminSubtitleLayoutEnabled}",
    );
  });

  it("fails closed when a non-canary user opens a generated caption edit URL", () => {
    expect(editPageSource).toContain("!uuidPattern.test(shortId)");
    expect(editPageSource).toContain("s.caption_render_spec");
    expect(editPageSource).toContain(
      "!parseCaptionRenderSpec(subtitleTemplateShort.captionRenderSpec)",
    );
  });
});
