import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createLocalAdminPreviewAnalysis,
  createLocalAdminPreviewState,
  createLocalAdminPreviewTemplates,
  localAdminPreviewEnabled,
  localAdminPreviewEnvironmentEnabled,
} from "@/lib/local-admin-preview";

const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);

describe("local admin preview", () => {
  it("requires development, the local flag, and the query opt-in", () => {
    expect(localAdminPreviewEnvironmentEnabled({ nodeEnv: "development", featureFlag: "true" })).toBe(true);
    expect(localAdminPreviewEnvironmentEnabled({ nodeEnv: "production", featureFlag: "true" })).toBe(false);
    expect(localAdminPreviewEnabled({ nodeEnv: "development", featureFlag: "true", queryValue: "1" })).toBe(true);
    expect(localAdminPreviewEnabled({ nodeEnv: "production", featureFlag: "true", queryValue: "1" })).toBe(false);
    expect(localAdminPreviewEnabled({ nodeEnv: "development", featureFlag: "false", queryValue: "1" })).toBe(false);
    expect(localAdminPreviewEnabled({ nodeEnv: "development", featureFlag: "true", queryValue: undefined })).toBe(false);
  });

  it("provides a complete admin fixture without active jobs", () => {
    const state = createLocalAdminPreviewState();
    const analysis = createLocalAdminPreviewAnalysis();
    const templates = createLocalAdminPreviewTemplates();

    expect(state.user?.displayName).toBe("로컬 어드민");
    expect(state.billing.hasManagedFeatureAccess).toBe(true);
    expect(state.recentJobs).toEqual([]);
    expect(analysis).toMatchObject({
      sourceRangeSelectionEnabled: true,
      subtitleTemplateSelectionEnabled: true,
      brandColorSelectionEnabled: true,
      creationAllowed: true,
    });
    expect(templates).toHaveLength(2);
  });

  it("blocks live state refresh, analysis, job creation, and support writes", () => {
    expect(shortsAppSource).toContain("if (localAdminPreview) return;");
    expect(shortsAppSource).toContain(
      'setError("로컬 어드민 미리보기에서는 실제 영상 분석을 호출하지 않습니다.")',
    );
    expect(shortsAppSource).toContain(
      'setError("로컬 어드민 미리보기에서는 실제 쇼츠를 생성하지 않습니다.")',
    );
    expect(shortsAppSource).toContain("!localAdminPreview && (\n      <SupportInquiryWidget");
  });
});
