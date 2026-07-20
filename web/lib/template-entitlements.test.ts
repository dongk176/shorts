import { describe, expect, it } from "vitest";
import {
  assertCustomTemplateAccess,
  billingSupportsCustomTemplates,
  planSupportsCustomTemplates,
} from "@/lib/template-entitlements";

describe("custom-template plan entitlements", () => {
  it.each([
    ["free", false],
    ["plus", false],
    ["standard", true],
    ["pro", true],
  ] as const)("maps the %s plan to %s", (planCode, expected) => {
    expect(planSupportsCustomTemplates(planCode)).toBe(expected);
  });

  it("requires a currently usable subscription", () => {
    expect(billingSupportsCustomTemplates({ planCode: "standard", canCreateJobs: false })).toBe(false);
    expect(() => assertCustomTemplateAccess({ planCode: "standard", canCreateJobs: false }))
      .toThrow("커스텀 템플릿은 스탠다드 또는 프로 플랜에서 사용할 수 있습니다.");
  });
});
