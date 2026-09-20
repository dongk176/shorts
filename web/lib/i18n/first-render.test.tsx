import { BackgroundShowcase } from "@/components/background-showcase";
import { TransformationShowcase } from "@/components/transformation-showcase";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PricingClient, type PricingState } from "@/app/pricing/pricing-client";
import { TossPricingClient } from "@/app/pricing/toss-pricing-client";
import { TOSS_SALE_PLAN_CATALOG } from "@/lib/toss-subscription";
import { createUiText } from "./ui-text";
import { AiShortsGuideContent } from "@/components/home-seo-content";
import { TemplateEditor } from "@/app/templates/template-editor";
import { CustomTemplateCanvasPreview } from "@/components/custom-template-canvas-preview";
import { ThePayOnePaymentOverlay } from "@/components/thepayone-payment-overlay";
import { UsageProvider } from "@/components/usage-provider";
import { createDefaultTemplateConfig, type CustomTemplate } from "@/lib/template-config";
import { I18nProvider } from "./provider";
import { messagesByLocale } from "./messages";
import type { SiteLocale } from "./config";

// A rewrite can expose the shared Korean pathname during the server render.
// The request locale must still win before any effect or DOM bridge runs.
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({}) }));

function render(children: ReactNode, locale: SiteLocale) {
  return renderToStaticMarkup(
    <I18nProvider locale={locale} messages={messagesByLocale[locale]}>
      <UsageProvider initialState={{ authenticated: false, accountId: null, isEnterprise: false, usage: null }}>
        {children}
      </UsageProvider>
    </I18nProvider>,
  );
}

const noop = () => {};
const guestState: PricingState = {
  user: null,
  billing: {
    hasPaymentHistory: false, lastPaidPlanCode: null, lastPaidBillingCycle: null, lastPaidAt: null,
    purchasedPackageCodes: [], activeProducts: [], hasManagedFeatureAccess: false,
    status: "none", planCode: "free", billingCycle: null, currentPeriodStart: null,
    currentPeriodEnd: null, nextChargeAt: null, cancelAtPeriodEnd: false,
    scheduledPlanCode: null, scheduledBillingCycle: null, cardIssuer: null,
    cardNumberMasked: null, cardLast4: null, hasStoredPayerTel: false,
    paymentProvider: null, providerScheduleStatus: "none", requiresManualReview: false,
    canCreateJobs: false, maxActiveJobs: 0, retentionDays: 1,
  },
};


describe("localized first render without browser effects", () => {
  it.each(["en", "ja"] as const)("renders only %s showcase media before hydration", (locale) => {
    const html = render(<><BackgroundShowcase /><TransformationShowcase /></>, locale);
    expect(html).toContain(`/home-showcase/${locale}/showcase-01.jpg`);
    expect(html).toContain(`/transformation-showcase/${locale}-horizontal-v1.mp4`);
    expect(html).toContain(`/transformation-showcase/${locale}-vertical-v1.mp4`);
    expect(html).not.toContain("/ditto-");
    expect(html).not.toContain("/home-showcase/showcase-");
    expect(html).not.toMatch(/[가-힣]/);
    expect(html).toContain("https://creativecommons.org/licenses/by/4.0/");
  });
  it.each(["en", "ja"] as const)("renders the live Toss catalog in %s without relying on the DOM bridge", (locale) => {
    const html = render(<TossPricingClient initialState={null} guestCatalog={[...TOSS_SALE_PLAN_CATALOG]} onRequireLogin={noop} />, locale);
    expect(html).not.toMatch(/[가-힣]/);
    for (const amount of ["9,900", "119,400", "288,000"]) expect(html).toContain(amount);
    expect(html).toContain(locale === "en" ? "About 48 Shorts per month" : "毎月ショート動画約48本");
    expect(html).toContain(locale === "en" ? "Subscribe to Easy Cut Pro" : "Easy Cut Proを申し込む");
    const ui = createUiText(locale);
    for (const plan of TOSS_SALE_PLAN_CATALOG) {
      expect(ui(`${plan.displayName}로 전환하기`)).not.toMatch(/[가-힣]/);
      expect(ui(`쇼츠 약 ${Math.round(plan.monthlyQuotaSeconds / 60 * 0.8 * plan.contractMonths)}개 · ${plan.contractMonths}개월`)).not.toMatch(/[가-힣]/);
    }
    for (const cycle of ["분기", "반기", "연간"]) {
      const text = ui(`${cycle} 결제 · 총 ₩119,400`);
      expect(text).not.toMatch(/[가-힣]/);
      expect(text).toContain("119,400");
    }
  });

  it.each(["en", "ja"] as const)("renders %s pricing and guide copy in the initial HTML", (locale) => {
    const html = render(<><PricingClient initialState={guestState} onRequireLogin={noop} /><AiShortsGuideContent /></>, locale);
    expect(html).not.toMatch(/[가-힣]/);
    expect(html).toContain("Easy Cut Pro");
    expect(html).toContain(locale === "en" ? "30 days" : "30日");
  });

  it.each(["en", "ja"] as const)("renders %s editor controls and accessible labels before hydration", (locale) => {
    const html = render(<TemplateEditor initialTemplate={null} baseTemplateId="dark-minimal" initialConfig={createDefaultTemplateConfig()} />, locale);
    for (const korean of ["내 템플릿으로 저장", "후킹 제목 폰트", "완성 영상과 같은 9:16 비율로 배경을 비교하세요.", "이미지 배경"]) {
      expect(html).not.toContain(korean);
    }
    expect(html).toContain(locale === "en" ? "Save as my template" : "マイテンプレートとして保存");
  });

  it.each(["en", "ja"] as const)("preserves authored %s canvas text even when it matches a UI phrase", (locale) => {
    const template: CustomTemplate = {
      id: "test-template", name: "저장", baseTemplateId: "dark-minimal", config: createDefaultTemplateConfig(),
      version: 1, createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z",
    };
    const html = render(<CustomTemplateCanvasPreview template={template} firstLine="저장" secondLine="취소" channelLabel="수정" />, locale);
    for (const text of ["저장", "취소", "수정"]) expect(html).toContain(text);
  });

  it("retains Korean copy on the Korean site", () => {
    const html = render(<PricingClient initialState={guestState} onRequireLogin={noop} />, "ko");
    expect(html).toContain("매월 자동결제");
  });

  it("localizes an unnamed payment dialog's accessible name on the server", () => {
    const html = render(<ThePayOnePaymentOverlay busy={false} primaryLabel="확인" onClose={noop} onSubmit={noop}>Test</ThePayOnePaymentOverlay>, "en");
    expect(html).not.toContain('aria-label="더페이원 결제"');
    expect(html).toContain('aria-label="ThePayOne payment"');
  });
});
