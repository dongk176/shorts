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

describe("subtitle template UI isolation", () => {
  it("mounts the test cards only behind the server capability", () => {
    expect(shortsAppSource).toContain("{subtitleTemplateSelectionEnabled && (");
    expect(shortsAppSource).toContain("자막 템플릿 · 테스트");
    expect(subtitleTemplatesSource).toContain("자막 기본형");
    expect(subtitleTemplatesSource).toContain("자막 강조형");
    expect(subtitleTemplatesSource).toContain("자막 팝형");
    expect(shortsAppSource).toContain("SUBTITLE_TEMPLATE_BRAND_COLOR");
    expect(shortsAppSource).toContain("canvasCqw(snapshot.title.fontSizePx)");
    expect(shortsAppSource).toContain("canvasCqw(snapshot.font.sizePx)");
    expect(shortsAppSource).toContain("canvasCqw(snapshot.wordGapPx)");
    expect(shortsAppSource).toContain("snapshot.title.secondLineColor");
    expect(shortsAppSource).toContain("이게 바로 자막입니다");
    expect(shortsAppSource).not.toContain("지금 이 순간을 놓치지 마세요");
    expect(shortsAppSource).not.toContain('whitespace-nowrap text-[9px]');
  });

  it("omits the new request field unless capability and selection are both present", () => {
    expect(shortsAppSource).toContain(
      "...(subtitleTemplateSelectionEnabled && subtitleTemplateId ? { subtitleTemplateId } : {})",
    );
  });

  it("uses the fixed dark-minimal shell and disables editing for generated captions", () => {
    expect(shortsAppSource).toContain('setTemplateId("dark-minimal")');
    expect(shortsAppSource).toContain("자막 편집은 다음 단계에서 지원해요.");
    expect(shortsAppSource).toContain("item.subtitleTemplateId");
  });

  it("fails closed when a generated caption edit URL is opened directly", () => {
    expect(editPageSource).toContain("!uuidPattern.test(shortId)");
    expect(editPageSource).toContain("and s.subtitle_template_id is not null");
    expect(editPageSource).toContain("if (subtitleTemplateShortRows[0]) notFound();");
  });
});
