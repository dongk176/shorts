import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const youtubeAnalysisSource = readFileSync(
  new URL("./youtube-analysis.ts", import.meta.url),
  "utf8",
);

describe("admin source range layout", () => {
  it("uses the admin-only capability for the compact source controls", () => {
    expect(youtubeAnalysisSource).toContain(
      "brandColorSelectionEnabled: subtitleTemplateAccess.enabled && subtitleTemplateAccess.isAdmin",
    );
    expect(shortsAppSource).toContain(
      "const adminCompactSourceRangeEnabled = brandColorSelectionEnabled;",
    );
    expect(shortsAppSource).toContain(
      "singleRowControls={adminCompactSourceRangeEnabled}",
    );
  });

  it("keeps start, end and reset in one visible row for admins", () => {
    expect(shortsAppSource).toContain(
      "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]",
    );
    expect(shortsAppSource).toContain('<SourceTimestampInput compact label="시작"');
    expect(shortsAppSource).toContain('<SourceTimestampInput compact label="종료"');
    expect(shortsAppSource).not.toContain("AdminSourceRangeStep");
    expect(shortsAppSource).not.toContain("사용할 부분 바꾸기");
  });

  it("removes the expected-shorts copy only from the admin range summary", () => {
    expect(shortsAppSource).toContain(
      "showPlannedShortCount={!adminCompactSourceRangeEnabled}",
    );
    expect(shortsAppSource).toContain(
      "{showPlannedShortCount ? ` · 예상 쇼츠 ${plannedShortCount}개` : \"\"}",
    );
  });

  it("restores the previous template experience", () => {
    expect(shortsAppSource).not.toContain("simplifiedAdminExperience");
    expect(shortsAppSource).not.toContain("어떤 느낌으로 만들까요?");
    expect(shortsAppSource).not.toContain("다른 스타일 보기");
    expect(shortsAppSource).not.toContain("직접 설정하기");
    expect(shortsAppSource).toContain('<h2 className="text-xl font-bold">템플릿</h2>');
    expect(shortsAppSource).toContain("leadingFavoriteCards.map(renderFavoriteCard)");
  });
});
