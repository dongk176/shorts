import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(
  new URL("./pricing-page-shell.tsx", import.meta.url),
  "utf8",
);
const tossSource = readFileSync(
  new URL("./toss-pricing-client.tsx", import.meta.url),
  "utf8",
);
const pricingStyles = readFileSync(
  new URL("./pricing.module.css", import.meta.url),
  "utf8",
);

describe("guest Toss pricing", () => {
  it("shows the public Toss catalog only while rollout and charges are enabled", () => {
    expect(pageSource).toContain("if (!user)");
    expect(pageSource).toContain(
      "runtime.effective.assignments && runtime.effective.charges",
    );
    expect(pageSource).toContain("guestTossCatalog = publicTossCatalog()");
  });

  it("opens the existing login dialog from a guest plan CTA", () => {
    expect(shellSource).toContain("guestCatalog={guestTossCatalog}");
    expect(shellSource).toContain("onRequireLogin={() => setLoginOpen(true)}");
    expect(tossSource).toMatch(
      /if \(guestCatalog\) \{\s*onRequireLogin\(\);\s*return;/,
    );
  });

  it("does not call authenticated Toss state or load its SDK for guests", () => {
    expect(tossSource).toContain("if (initialState || guestCatalog) return;");
    expect(tossSource).toContain("!guestCatalog ? (");
    expect(tossSource).toContain("state?.catalog ?? guestCatalog ?? []");
    expect(tossSource).toContain("const loading = !state && !guestCatalog;");
  });

  it("fixes Pro to monthly and exposes only 3, 6, and 12 months for packages", () => {
    expect(tossSource).toContain("const PACKAGE_TERMS = [3, 6, 12] as const");
    expect(tossSource).toContain("<span>패키지 이용기간</span>");
    expect(tossSource).toContain('aria-label="패키지 이용기간"');
    expect(tossSource).toContain('? plan.contractMonths === 1');
    expect(tossSource).not.toContain('term === 1 ? "월간"');
  });

  it("keeps amounts and generic payment copy out of the dialog while showing plan performance", () => {
    expect(tossSource).not.toContain("카드 등록과 결제 후 바로 시작됩니다.");
    expect(tossSource).not.toContain("등록 카드 결제 후 바로 전환됩니다.");
    expect(tossSource).not.toContain("chargeAmountKrw:");
    expect(tossSource).toContain("styles.localPlanSummaryFeatures");
    expect(tossSource).toContain("features(selection.plan).slice(0, 5)");
    expect(tossSource).toContain("!state.paymentRestrictions.hanaCardAvailable");
    expect(tossSource).toContain("하나카드는 아직 결제할 수 없어요");
  });

  it("adds a desktop-only divider and readable checkout summaries", () => {
    expect(pricingStyles).toMatch(
      /@media \(min-width: 901px\)[\s\S]*?\.localPlanGrid::before\s*\{/,
    );
    expect(pricingStyles).toMatch(
      /\.localPlanSummaryFeatures\s*\{[^}]*font-size:\s*13px;/,
    );
    expect(tossSource).not.toContain("styles.localDialogLead");
    expect(tossSource).not.toContain("styles.localPaymentNote");
  });

  it("keeps the maximum-discount badge the same size as the best-value badge", () => {
    expect(tossSource).toContain(
      '<span className={`pricing-badge ${styles.localReasonableBadge}`}>가장 합리적</span>',
    );
    expect(tossSource).toContain(
      '<span className={`pricing-badge ${styles.localReasonableBadge}`}>최대 할인</span>',
    );
  });

  it("gives the primary dialog action twice the width of cancel", () => {
    expect(pricingStyles).toMatch(
      /\.localDialogActions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(86px,\s*1fr\)\s+minmax\(0,\s*2fr\);/,
    );
    expect(pricingStyles).toMatch(
      /\.localDialogActions button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
    );
    expect(pricingStyles).toMatch(
      /\.localDialogActions button:first-child\s*\{[^}]*font-size:\s*14px;/,
    );
    expect(pricingStyles).toMatch(
      /\.localDialogActions button:last-child\s*\{[^}]*font-size:\s*16px;/,
    );
  });
});
