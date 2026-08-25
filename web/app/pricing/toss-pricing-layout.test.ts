import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const clientSource = readFileSync(
  new URL("./toss-pricing-client.tsx", import.meta.url),
  "utf8",
);
const pricingStyles = readFileSync(
  new URL("./pricing.module.css", import.meta.url),
  "utf8",
);

describe("production Toss pricing layout", () => {
  it("keeps Pro monthly while packages expose only 3, 6, and 12 months", () => {
    expect(clientSource).toContain("const PACKAGE_TERMS = [3, 6, 12] as const");
    expect(clientSource).toContain('plan.tier === "easycut_pro"');
    expect(clientSource).toContain("? plan.contractMonths === 1");
    expect(clientSource).toContain('<span>패키지 이용기간</span>');
  });

  it("uses familiar billing-cycle labels for every selectable term", () => {
    expect(clientSource).toContain('if (contractMonths === 1) return "월간 결제"');
    expect(clientSource).toContain('if (contractMonths === 3) return "분기 결제"');
    expect(clientSource).toContain('if (contractMonths === 6) return "반기 결제"');
    expect(clientSource).toContain('return "연간 결제"');
    expect(clientSource).not.toContain("개월마다 정기결제");
    expect(clientSource).not.toContain("월간 정기결제");
  });

  it("separates Pro from package cards only on desktop", () => {
    expect(pricingStyles).toMatch(
      /@media \(min-width: 901px\)\s*\{[\s\S]*?\.localPlanGrid::before\s*\{/,
    );
    expect(pricingStyles).toContain(
      "grid-template-columns: minmax(0, 1fr) 2px repeat(2, minmax(0, 1fr))",
    );
    expect(pricingStyles).toContain("column-gap: 30px");
    expect(pricingStyles).toMatch(
      /\.localPlanGrid::before\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?margin:\s*18px 0;/,
    );
  });

  it("uses equal badge sizing and a wider primary confirmation action", () => {
    expect(clientSource.match(/styles\.localReasonableBadge/g)).toHaveLength(2);
    expect(pricingStyles).toMatch(
      /\.localPlanGrid \.localReasonableBadge\s*\{[\s\S]*?min-width:\s*116px;/,
    );
    expect(clientSource).toContain('? "시작하기"');
    expect(clientSource).not.toContain('? "구독 확인"');
    expect(pricingStyles).toMatch(
      /\.localDialogActions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(86px, 1fr\) minmax\(0, 2fr\);/,
    );
    expect(pricingStyles).toMatch(
      /\.localDialogActions button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
    );
  });

  it("keeps the desktop CTA spacing equal to the existing mobile spacing", () => {
    expect(pricingStyles).toMatch(
      /\.localPlanCard \.planCta\s*\{[\s\S]*?margin-top:\s*24px;/,
    );
  });

  it("shows plan performance and omits subtitle and amount messaging", () => {
    expect(clientSource).not.toContain("플랜 구독을 시작할까요?");
    expect(clientSource).not.toContain("플랜으로 전환할까요?");
    expect(clientSource).not.toContain("styles.localDialogLead");
    expect(clientSource).not.toContain("styles.localPaymentNote");
    expect(clientSource).not.toContain("chargeAmountKrw:");
    expect(clientSource).toContain("styles.localPlanSummaryFeatures");
    expect(clientSource).toContain("features(selection.plan).slice(0, 5)");
  });
});
