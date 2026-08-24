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

  it("keeps the month picker but removes its visible payment-cycle label", () => {
    expect(tossSource).not.toContain("<span>결제 주기</span>");
    expect(tossSource).toContain('aria-label="구독 결제 주기"');
    expect(tossSource).toContain('term === 1 ? "월간"');
    expect(tossSource).toContain('term === 12 ? "연간"');
    expect(tossSource).toContain('`${term}개월`');
  });

  it("keeps amounts out of the confirmation dialog and explains the Hana Card restriction", () => {
    expect(tossSource).toContain("카드 등록과 결제 후 바로 시작됩니다.");
    expect(tossSource).toContain("등록 카드 결제 후 바로 전환됩니다.");
    expect(tossSource).not.toContain("카드 등록과 ${won(");
    expect(tossSource).not.toContain("등록 카드로 ${selection.chargeAmountKrw");
    expect(tossSource).toContain("!state.paymentRestrictions.hanaCardAvailable");
    expect(tossSource).toContain("하나카드는 아직 결제할 수 없어요");
  });

  it("keeps plan prices balanced across mobile and desktop and enlarges checkout summaries", () => {
    expect(pricingStyles).toMatch(
      /@media \(max-width: 900px\)[\s\S]*?\.localPlanCard \.planCta\s*\{\s*margin-top:\s*24px;/,
    );
    expect(pricingStyles).toMatch(/\.localDialogLead\s*\{[^}]*font-size:\s*15px;/);
    expect(pricingStyles).toMatch(/\.localPlanSummaryCopy strong\s*\{[^}]*font-size:\s*16px;/);
    expect(pricingStyles).toMatch(/\.localPlanTransitionItem strong\s*\{[^}]*font-size:\s*14px;/);
    expect(pricingStyles).toMatch(/\.localPaymentNote\s*\{[^}]*font-size:\s*13px;/);
    expect(pricingStyles).toMatch(
      /\.localPlanPrice strong\s*\{[^}]*font-size:\s*clamp\(2\.5rem,\s*4\.1vw,\s*2\.75rem\);/,
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
