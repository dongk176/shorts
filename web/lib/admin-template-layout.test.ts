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

describe("admin template layout", () => {
  it("uses the server-authorized admin capability for every layout change", () => {
    expect(youtubeAnalysisSource).toContain(
      "brandColorSelectionEnabled: subtitleTemplateAccess.enabled && subtitleTemplateAccess.isAdmin",
    );
    expect(shortsAppSource).toContain(
      "const adminTemplateLayoutEnabled = brandColorSelectionEnabled;",
    );
    expect(shortsAppSource).toContain(
      "settingsBelowRail={adminTemplateLayoutEnabled}",
    );
  });

  it("moves ratio and brand controls below the template rail only for admins", () => {
    const standardSettings = shortsAppSource.indexOf(
      "{!settingsBelowRail && templateSettings}",
    );
    const templateRail = shortsAppSource.indexOf('aria-label="템플릿 선택 레일"');
    const adminSettings = shortsAppSource.indexOf(
      "{settingsBelowRail && templateSettings}",
    );

    expect(standardSettings).toBeGreaterThan(-1);
    expect(standardSettings).toBeLessThan(templateRail);
    expect(adminSettings).toBeGreaterThan(templateRail);
  });

  it("hides the source usage copy from admins while preserving it for users", () => {
    expect(shortsAppSource).toContain("{!adminTemplateLayoutEnabled && (");
    expect(shortsAppSource).toContain(
      "원본 영상 {formatDuration(analysis.durationSeconds)} · 예상 쇼츠 {selectedPlannedShortCount}개",
    );
    expect(shortsAppSource).toContain(
      "`선택한 ${formatDuration(selectedSourceDurationSeconds)}만 사용량으로 계산됩니다.`",
    );
  });

  it("removes only the admin settings outer card", () => {
    expect(shortsAppSource).toContain("style={adminTemplateLayoutEnabled ? {");
    expect(shortsAppSource).toContain('background: "transparent"');
    expect(shortsAppSource).toContain('boxShadow: "none"');
    expect(shortsAppSource).toContain('backdropFilter: "none"');
  });

  it("places the analyzed settings directly below the URL area for admins only", () => {
    expect(shortsAppSource).toContain(
      'adminTemplateLayoutEnabled ? "flex flex-col gap-10" : "space-y-10"',
    );
    expect(shortsAppSource).toContain(
      'adminTemplateLayoutEnabled ? "order-[-2]" : ""',
    );
    expect(shortsAppSource).toContain(
      'adminTemplateLayoutEnabled ? "order-[-1]" : ""',
    );
    expect(shortsAppSource).toContain(
      "- (adminTemplateLayoutEnabled ? 8 : 16)",
    );
  });

  it("keeps create active before rights confirmation and draws attention instead", () => {
    expect(shortsAppSource).toContain("if (!rightsConfirmed) {");
    expect(shortsAppSource).toContain("setRightsConfirmationAttention(true);");
    expect(shortsAppSource).toContain(
      'rightsConfirmationRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });',
    );
    expect(shortsAppSource).toContain(
      'rightsCheckboxRef.current?.focus({ preventScroll: true });',
    );
    expect(shortsAppSource).toContain(
      'disabled={analysisCreationBlocked || !sourceRangeIsValid || busy || stateLoadStatus !== "ready"}',
    );
    expect(shortsAppSource).not.toContain(
      'disabled={analysisCreationBlocked || !sourceRangeIsValid || !rightsConfirmed || busy',
    );
  });
});
