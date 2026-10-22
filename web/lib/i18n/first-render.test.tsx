import { SnsShortEditor } from "@/components/sns-short-editor";
import { SnsTemplatePreview } from "@/components/sns-template-preview";
import { TemplateLibrary } from "@/app/templates/template-library";
import type { GeneratedShort } from "@/lib/contracts";
import { ContentLanguageSelect } from "@/components/content-language-select";
import { EditorFontPicker } from "@/components/editor-font-picker";
import { regularEditorFontOptions } from "@/lib/editor-fonts";
import { upgradeTemplateConfigToV5 } from "@/lib/template-config";
import { BackgroundShowcase } from "@/components/background-showcase";
import { TransformationShowcase } from "@/components/transformation-showcase";
import { showcaseAsset } from "@/lib/showcase-delivery";
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
  it.each(["en", "ja"] as const)("localizes %s social and community sample content in every aspect ratio", (locale) => {
    for (const community of [false, true]) {
      for (const ratio of ["16:9", "5:4", "1:1", "4:5", "9:16"] as const) {
        const html = render(<SnsTemplatePreview community={community} ratio={ratio} brandColor="#ffd84d"
          channelName="" channelThumbnailUrl={null} thumbnailUrl="/sample.jpg" />, locale);
        expect(html).not.toMatch(/[가-힣]/);
        expect(html).toContain(community
          ? locale === "ja" ? "この場面が話題の理由" : "Why everyone is talking about this"
          : locale === "ja" ? "もう一度見たくなる瞬間" : "Worth another look");
      }
    }
  });

  it("preserves Korean authored social content and explicit output language on a Japanese site", () => {
    for (const community of [false, true]) {
      const html = render(<SnsTemplatePreview community={community} language="ko" ratio="16:9" brandColor="#ffd84d"
        channelName="내 채널" channelThumbnailUrl={null} thumbnailUrl="/sample.jpg"
        content={{ boardName: "내 게시판", title: "원본 제목", body: ["원본 본문", "두 번째 줄"], hashtags: ["#원본"] }} />, "ja");
      for (const authored of ["내 채널", "원본 제목", "원본 본문"]) expect(html).toContain(authored);
      if (community) expect(html).toContain("실시간 베스트");
      expect(html).not.toContain("この場面が話題の理由");
    }
  });

  it.each(["en", "ja"] as const)("localizes %s personal library preview samples while preserving the saved name", (locale) => {
    const config = upgradeTemplateConfigToV5(createDefaultTemplateConfig());
    config.subtitle.visible = true;
    const template: CustomTemplate = {
      id: "owned-template", name: "사용자 지정 이름", baseTemplateId: "dark-minimal",
      config, version: 1,
      createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z",
    };
    const html = render(<TemplateLibrary personalTemplates={[template]} authenticated canUseCustomTemplates
      adminPresetNamesEnabled unifiedSubtitleCanaryEnabled unifiedSubtitlePreviewEnabled initialFavoriteTemplateKeys={[]} />, locale);
    expect(html).toContain(template.name);
    const personalCard = html.match(/<article\b[\s\S]*?<\/article>/)?.[0] || "";
    expect(personalCard).toContain(template.name);
    expect(personalCard.replaceAll(template.name, "").match(/[가-힣]+/g)).toBeNull();
    expect(html).toContain(`href="/${locale === "ja" ? "jp" : "en"}/templates/${template.id}/edit"`);
  });

  it.each(["en", "ja"] as const)("localizes %s community editor controls and preserves authored content", (locale) => {
    const item = {
      id: "5eddeec0-39cd-4497-87b7-ebbcd5499971", videoAspectRatio: "16:9", channelDisplayName: "저장",
      startSeconds: 0, endSeconds: 10, status: "ready", renderVersion: 1,
      templateSnapshot: { communityTemplateVersion: 1, snsTemplateVersion: 1, snsLanguage: "ko", brandColor: "#ffd84d",
        snsContent: { boardName: "나의 게시판", title: "수정 반영", body: ["원본 문구 보존"], hashtags: [] } },
    } as unknown as GeneratedShort;
    const html = render(<SnsShortEditor item={item} projectNumber={42} channelThumbnailUrl={null}
      release={{ channel: "legacy", releaseId: null, uiVersion: null, documentVersion: null, subtitleEditingCapable: false, subtitleEditingPublicEnabled: false }}
      canEdit onChanged={async () => {}} />, locale);
    expect(html).toContain(locale === "en" ? "Edit community template" : "コミュニティ風を編集");
    // The shared inspector initially shows the title tool; other fields stay in the preview.
    expect(html).toContain(locale === "en" ? "Editing tools" : "編集ツール");
    expect(html).toContain(locale === "en" ? 'aria-label="Back to projects"' : 'aria-label="プロジェクトに戻る"');
    for (const label of ["시작(초)", "SNS 제목", "커뮤니티 게시판 이름", "최상단 네모 배경에 적용됩니다."]) expect(html).not.toContain(label);
    expect(html).toContain('value="수정 반영"');
    for (const authored of ["나의 게시판", "수정 반영", "원본 문구 보존", "저장"]) expect(html).toContain(authored);
    expect(html).toContain('data-i18n-content=""');
  });


  it.each(["en", "ja"] as const)("localizes every %s template font and default name without changing font IDs", (locale) => {
    const html = render(<TemplateEditor initialTemplate={null} baseTemplateId="dark-minimal"
      initialConfig={upgradeTemplateConfigToV5(createDefaultTemplateConfig())}
      unifiedSubtitleCanaryEnabled suggestedName="자막 팝형 템플릿" />, locale);
    expect(html).toContain(locale === "en" ? "Pop-up caption template" : "ポップアップ字幕テンプレート");
    for (const font of regularEditorFontOptions) {
      expect(html).toContain(`value="${font.id}"`);
      if (/[가-힣]/.test(font.label)) expect(html).not.toContain(font.label);
    }
    const picker = render(<EditorFontPicker value="paperlogy" onChange={noop} />, locale);
    expect(picker).toContain("Paperlogy");
    expect(picker).not.toContain("페이퍼로지");
  });

  it.each(["en", "ja"] as const)("localizes the %s language-select trigger before effects", (locale) => {
    const html = render(<ContentLanguageSelect id="test-language" labelledBy="test-label" prefix="언어"
      value="all" options={[{ value: "all", label: "전체" }]} onChange={noop} />, locale);
    expect(html).not.toMatch(/[가-힣]/);
    expect(html).toContain(locale === "en" ? "Language" : "言語");
  });

  it.each(["en", "ja"] as const)("preserves an existing %s template name that resembles a default", (locale) => {
    const template: CustomTemplate = {
      id: "owned-template", name: "자막 팝형 템플릿", baseTemplateId: "dark-minimal", config: createDefaultTemplateConfig(),
      version: 1, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z",
    };
    const html = render(<TemplateEditor initialTemplate={template} baseTemplateId="dark-minimal" initialConfig={template.config} />, locale);
    expect(html).toContain('value="자막 팝형 템플릿"');
  });

  it.each(["en", "ja"] as const)("renders only %s showcase media before hydration", (locale) => {
    const html = render(<><BackgroundShowcase /><TransformationShowcase /></>, locale);
    for (const category of ["talk", "entertainment", "review", "education", "gaming", "vlog"]) {
      for (const style of [1, 2, 3]) {
        expect(html).toContain(showcaseAsset(`${locale}-${category}-${style}`, "poster"));
      }
    }
    expect(html).not.toContain(`/home-showcase/${locale}/`);
    expect(html).toContain(showcaseAsset(`${locale}-talk-source`, "poster"));
    // One source plus three actual renderer outputs, with no in-video controls.
    expect(html.match(/<video\b/g)).toHaveLength(4);
    expect(html).not.toMatch(/<video\b[^>]*\ssrc=/);
    expect(html.match(/preload="none"/g)).toHaveLength(4);
    expect(html.match(/role="tab"/g)).toHaveLength(6);
    expect(html).not.toContain(`/transformation-showcase/${locale === "en" ? "ja" : "en"}-horizontal-v1.mp4`);
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
