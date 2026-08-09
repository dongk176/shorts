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

describe("admin first-project settings", () => {
  it("enables the simplified flow only from the admin-only brand color capability", () => {
    expect(youtubeAnalysisSource).toContain(
      "brandColorSelectionEnabled: subtitleTemplateAccess.enabled && subtitleTemplateAccess.isAdmin",
    );
    expect(shortsAppSource).toContain(
      "const adminSimplifiedSettingsEnabled = brandColorSelectionEnabled;",
    );
    expect(shortsAppSource).toContain(
      "simplifiedAdminExperience={adminSimplifiedSettingsEnabled}",
    );
    expect(shortsAppSource).toContain(
      "!adminSimplifiedSettingsEnabled\n          && sourceRangeSelectionEnabled",
    );
  });

  it("shows a three-step, beginner-friendly admin flow", () => {
    expect(shortsAppSource).toContain("이 영상으로 쇼츠를 만들어볼까요?");
    expect(shortsAppSource).toContain("1. 어느 부분을 사용할까요?");
    expect(shortsAppSource).toContain("2. 어떤 느낌으로 만들까요?");
    expect(shortsAppSource).toContain("댓글과 함께");
    expect(shortsAppSource).toContain("통통 튀는 자막");
    expect(shortsAppSource).toContain("핵심 강조 자막");
    expect(shortsAppSource).toContain("이 설정으로 쇼츠 만들기");
  });

  it("keeps advanced choices collapsed and makes subtitle position a single toggle", () => {
    expect(shortsAppSource).toContain("사용할 부분 바꾸기");
    expect(shortsAppSource).toContain(
      "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]",
    );
    expect(shortsAppSource).toContain("다른 스타일 보기");
    expect(shortsAppSource).toContain("직접 설정하기");
    expect(shortsAppSource).toContain("자막은 영상 {");
    expect(shortsAppSource).toContain("가운데로 바꾸기");
    expect(shortsAppSource).toContain("아래쪽으로 바꾸기");
  });

  it("retains the existing general-user controls behind the original branch", () => {
    expect(shortsAppSource).toContain("!simplifiedAdminExperience && <div");
    expect(shortsAppSource).toContain('<h2 className="text-xl font-bold">템플릿</h2>');
    expect(shortsAppSource).toContain("선택 범위 초기화");
    expect(shortsAppSource).toContain(
      "!simplifiedAdminExperience && subtitleTemplateSelectionEnabled && subtitleTemplateId",
    );
    expect(shortsAppSource).toContain('aria-label="자막 위치 선택"');
  });
});
