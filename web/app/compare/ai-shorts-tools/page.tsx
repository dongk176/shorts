import { createUiText } from "@/lib/i18n/ui-text";
import { getRequestLocale } from "@/lib/i18n/server";
import { createLocalizedPageMetadata } from "@/lib/i18n/metadata";
import Link from "@/lib/i18n/navigation";
import { AuthControls } from "@/components/auth-controls";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { comparisonPricing } from "@/lib/comparison-pricing";
import { paddleConfigured, paddleEnabled } from "@/lib/paddle/config";
import { publicMonthlyOffer } from "@/lib/seo-structured-data";
import { authProfile } from "@/lib/session";
import { seoCopyForPath } from "@/lib/seo-localization";
import { localizedArticle, localizedBreadcrumb } from "@/lib/seo-structured-data";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const PAGE_PATH = "/compare/ai-shorts-tools";
const PUBLISHED_DATE = "2026-07-19";
const REVIEWED_DATE = "2026-10-01";

export async function generateMetadata() {
  return createLocalizedPageMetadata({
    title: "AI 쇼츠 제작 툴 비교: 이지컷·알파컷·피카클립",
    description: "이지컷의 리뉴얼 요금제와 알파컷, 피카클립의 이용량 기준, AI 하이라이트, 자막, 템플릿과 편집 기능을 공식 공개정보 기준으로 정리합니다.",
    path: PAGE_PATH,
    type: "article",
  });
}

const comparisonRows = [
  {
    label: "대표 입력 방식",
    easyCut: "YouTube 링크·파일 업로드",
    alphaCut: "YouTube 링크·파일 업로드",
    fikaClip: "기존 영상 기반",
  },
  {
    label: "이용량 기준",
    easyCut: "원본 영상 처리시간",
    alphaCut: "원본 영상 처리시간",
    fikaClip: "영상 길이·기능별 크레딧",
  },
  {
    label: "공개 플랜 제공량",
    easyCut: "월 60·200·600분",
    alphaCut: "공식 페이지에서 최신 정보 확인",
    fikaClip: "월 500·1,500·5,000 크레딧",
  },
  {
    label: "유료 플랜 월간 결제",
    easyCut: "월 9,900원 또는 기간 패키지",
    alphaCut: "공식 페이지에서 최신 정보 확인",
    fikaClip: "공식 요금표에서 통화·할인 조건 확인",
  },
  {
    label: "하이라이트 자동 추출",
    easyCut: "제공",
    alphaCut: "제공",
    fikaClip: "제공",
  },
  {
    label: "제목·자막 편집",
    easyCut: "제목·자막·표시명 수정",
    alphaCut: "제목·길이·비율 조절 안내",
    fikaClip: "AI 제목 추천·텍스트·자막 편집",
  },
  {
    label: "화면 비율",
    easyCut: "5종: 16:9~9:16",
    alphaCut: "비율 조절 안내",
    fikaClip: "비율·스타일 설정",
  },
  {
    label: "템플릿",
    easyCut: "다양한 템플릿·자막 스타일",
    alphaCut: "커스텀 템플릿",
    fikaClip: "비디오·채널 스타일 템플릿",
  },
  {
    label: "프로젝트 보관",
    easyCut: "전 유료 상품 30일",
    alphaCut: "멤버십 편집 30일 안내",
    fikaClip: "공식 페이지에서 최신 정보 확인",
  },
  {
    label: "동시 작업",
    easyCut: "상품별 1·2·3개",
    alphaCut: "공식 페이지에서 최신 정보 확인",
    fikaClip: "공식 페이지에서 최신 정보 확인",
  },
] as const;

const selectionGuides = [
  {
    title: "처리시간으로 계획하고 싶다면",
    description: "영상 분량을 기준으로 월 작업량을 계산한다면 원본 처리시간을 제공량으로 표시하는 이지컷과 알파컷을 함께 살펴볼 수 있습니다.",
  },
  {
    title: "크레딧으로 관리하고 싶다면",
    description: "피카클립은 원본 영상 길이와 사용 기능에 따라 크레딧을 차감합니다. 결과 영상 개수와 크레딧 사용량을 구분해서 확인하세요.",
  },
  {
    title: "여러 작업을 동시에 돌린다면",
    description: "운영팀이라면 각 서비스의 동시 작업 한도와 프로젝트 보관기간을 공식 페이지에서 함께 확인하는 것이 좋습니다.",
  },
] as const;

export default async function AiShortsToolsComparisonPage() {
  const locale = await getRequestLocale();
  const ui = createUiText(locale);
  const internationalPricing = paddleConfigured() && paddleEnabled();
  const easyCutPriceCards = comparisonPricing(locale, internationalPricing);
  const offer = publicMonthlyOffer(locale, internationalPricing);
  const monthlyPrice = offer ? new Intl.NumberFormat(locale === "ja" ? "ja-JP" : locale === "en" ? "en-US" : "ko-KR", { style: "currency", currency: offer.priceCurrency }).format(Number(offer.price)) : null;
  const priceSummary = monthlyPrice ? locale === "ja" ? `月額 ${monthlyPrice} または期間パッケージ` : locale === "en" ? `${monthlyPrice}/month or a term package` : `월 ${monthlyPrice} 또는 기간 패키지` : ui("공식 페이지에서 최신 정보 확인");
  const user = await getAuthenticatedUser();
  const searchCopy = seoCopyForPath(PAGE_PATH, locale) ?? { title: "AI 쇼츠 제작 툴 비교: 이지컷·알파컷·피카클립", description: "이지컷, 알파컷, 피카클립의 공개 기능과 요금 기준을 비교한 가이드" };
  const articleData = localizedArticle(locale, PAGE_PATH, searchCopy.title, searchCopy.description, PUBLISHED_DATE, REVIEWED_DATE);
  const breadcrumbData = localizedBreadcrumb(locale, PAGE_PATH, searchCopy.title.split(" | ")[0]);
  return (
    <div className="app-shell site-chrome desktop-sidebar-layout min-h-screen text-neutral-100">
      <StructuredData data={articleData} />
      <StructuredData data={breadcrumbData} />
      <SiteHeader desktopSidebar><AuthControls user={user ? authProfile(user) : null} next={PAGE_PATH} /></SiteHeader>
      <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-10 sm:px-8 sm:pt-14">
        <header className="mx-auto max-w-4xl py-12 text-center sm:py-16">
          <p className="text-xs font-black uppercase tracking-[.2em] text-[#ff9b8d]">2026 AI Shorts Tools</p>
          <h1 className="mt-5 text-[28px] font-black leading-tight tracking-[-.05em] text-white sm:text-[42px]">{ui("이지컷·알파컷·피카클립")}<br /><span className="bg-gradient-to-r from-[#ff8c7c] to-violet-400 bg-clip-text text-transparent">{ui("AI 쇼츠 제작 툴 비교")}</span></h1>
          <p className="mx-auto mt-6 max-w-3xl text-sm leading-7 text-neutral-400 sm:text-base">{ui("롱폼 영상을 짧은 쇼츠로 바꾸는 서비스마다 잘 맞는 제작 방식이 다릅니다. 이 페이지는 우열을 정하기보다 각 서비스의 공식 공개정보와 선택 기준을 같은 항목으로 정리합니다.")}</p>
          <p className="mt-4 text-xs text-neutral-500">{ui("요금·이용량 정보 재확인: 2026년 10월 1일. 확인되지 않은 가격은 공식 페이지로 안내합니다.")}</p>
        </header>

        <section aria-labelledby="quick-answer-title">
          <h2 id="quick-answer-title" className="text-2xl font-black tracking-[-.035em] text-white">{ui("서비스별로 잘 맞는 활용 방식")}</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <article className="rounded-2xl border border-[#ff8c7c]/30 bg-[#ff8c7c]/[.06] p-6">
              <h3 className="text-lg font-black text-[#ffb4a8]">{ui("이지컷(Easy Cut)")}</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-300">{ui("YouTube URL 중심의 간단한 흐름, 5가지 비율, 8개 제목 언어와 상품별 동시 작업 수가 필요한 경우 잘 맞습니다.")}</p>
            </article>
            <article id="alphacut" className="scroll-mt-28 rounded-2xl border border-white/10 bg-black/15 p-6">
              <h3 className="text-lg font-black text-white">{ui("알파컷(AlphaCut)")}</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-400">{ui("YouTube 링크와 파일 업로드, 무음 구간 제거·화자 트래킹 등 공식 안내 기능이 필요한 경우 잘 맞습니다.")}</p>
            </article>
            <article id="fikaclip" className="scroll-mt-28 rounded-2xl border border-white/10 bg-black/15 p-6">
              <h3 className="text-lg font-black text-white">{ui("피카클립(FikaClip)")}</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-400">{ui("영상 길이와 편집 기능별 크레딧 사용량을 확인하며 제작하려는 경우 살펴볼 수 있습니다.")}</p>
            </article>
          </div>
        </section>

        <section aria-labelledby="renewed-pricing-title" className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#ff9b8d]">Renewed pricing</p>
              <h2 id="renewed-pricing-title" className="mt-2 text-2xl font-black tracking-[-.035em] text-white">{ui("이지컷 리뉴얼 요금제")}</h2>
            </div>
            <Link href="/pricing" className="text-sm font-extrabold text-[#ff9b8d] hover:text-white">{ui("전체 요금제 보기 →")}</Link>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-neutral-400">{ui("월간 구독과 3·6·12개월 패키지 중 제작량과 이용기간에 맞춰 선택할 수 있습니다.")}</p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {easyCutPriceCards.map((card) => (
              <article key={card.title} className="rounded-2xl border border-[#ff8c7c]/20 bg-[#ff8c7c]/[.045] p-6">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-black text-white">{ui(card.title)}</h3>
                  <span className="shrink-0 rounded-full bg-[#ff8c7c]/10 px-3 py-1 text-xs font-black text-[#ffb4a8]">{ui(card.allowance)}</span>
                </div>
                <ul className="mt-5 grid gap-2 text-sm leading-6 text-neutral-200">
                  {card.priceLines.map((line) => <li key={ui(line)}>{ui(line)}</li>)}
                </ul>

              </article>
            ))}
          </div>
          <p className="mt-4 text-xs leading-6 text-neutral-500">{ui("패키지는 선택한 기간의 총액을 결제하며, 표시된 월 금액은 비교를 위한 월 환산액입니다.")}</p>
          <p className="mt-2 text-xs leading-6 text-neutral-500">{ui("추가시간과 계정별 적용 상품은 요금제 페이지에서 확인하세요.")}</p>
        </section>

        <section aria-labelledby="comparison-table-title" className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.18em] text-violet-300">Feature matrix</p>
              <h2 id="comparison-table-title" className="mt-2 text-2xl font-black tracking-[-.035em] text-white">{ui("기능·제공량 비교표")}</h2>
            </div>
            <p className="text-xs text-neutral-500">{ui("가격과 기능은 변경될 수 있으므로 결제 전 공식 페이지를 확인하세요.")}</p>
          </div>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[850px] border-collapse text-left text-sm">
              <thead className="bg-white/[.045] text-neutral-300">
                <tr>
                  <th className="px-5 py-4 font-extrabold">{ui("비교 항목")}</th>
                  <th className="px-5 py-4 font-extrabold text-[#ffb4a8]">{ui("이지컷")}</th>
                  <th className="px-5 py-4 font-extrabold">{ui("알파컷")}</th>
                  <th className="px-5 py-4 font-extrabold">{ui("피카클립")}</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-t border-white/[.07] align-top">
                    <th className="px-5 py-4 font-bold text-white">{ui(row.label)}</th>
                    <td className="bg-[#ff8c7c]/[.035] px-5 py-4 text-neutral-200">{row.label === "유료 플랜 월간 결제" ? priceSummary : ui(row.easyCut)}</td>
                    <td className="px-5 py-4 text-neutral-400">{ui(row.alphaCut)}</td>
                    <td className="px-5 py-4 text-neutral-400">{ui(row.fikaClip)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-6 text-neutral-500">{ui("서비스별 상품과 기능은 수시로 바뀔 수 있습니다. 표에 구체적인 정보가 없는 항목은 미지원이라는 뜻이 아니며, 각 서비스의 공식 페이지에서 최신 내용을 확인해 주세요.")}</p>
        </section>

        <section aria-labelledby="alternative-title" className="mt-10">
          <h2 id="alternative-title" className="text-2xl font-black tracking-[-.035em] text-white">{ui("나에게 맞는 서비스를 고를 때 볼 것")}</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {selectionGuides.map((guide) => (
              <article key={guide.title} className="rounded-2xl border border-white/10 bg-black/15 p-6">
                <h3 className="font-extrabold text-white">{ui(guide.title)}</h3>
                <p className="mt-3 text-sm leading-7 text-neutral-400">{ui(guide.description)}</p>
              </article>
            ))}
          </div>
          <div className="mt-7 rounded-2xl border border-violet-400/20 bg-violet-400/[.06] p-6">
            <h3 className="font-extrabold text-violet-200">{ui("비교표보다 중요한 실제 테스트")}</h3>
            <p className="mt-3 text-sm leading-7 text-neutral-300">{ui("같은 한국어 인터뷰나 강의 영상을 각 서비스에 넣고 하이라이트 구간, 자막 수정량, 제작 시간과 결과 개수를 직접 비교하는 것이 가장 정확합니다. 영상 유형과 편집 기준에 따라 결과는 달라질 수 있습니다.")}</p>
          </div>
        </section>

        <section aria-labelledby="sources-title" className="mt-10">
          <h2 id="sources-title" className="text-xl font-black text-white">{ui("비교 출처")}</h2>
          <ul className="mt-5 grid gap-3 text-sm leading-6 text-neutral-400">
            <li>{ui("이지컷: ")}<Link href="/pricing" className="font-bold text-[#ff9b8d] underline underline-offset-4">{ui("공식 요금제")}</Link> {ui(" 및 현재 서비스 공개 기능")}</li>
            <li>{ui("알파컷: ")}<a href="https://alphacut.video/" target="_blank" rel="noreferrer" className="font-bold text-[#ff9b8d] underline underline-offset-4">{ui("공식 홈페이지")}</a> · <a href="https://alphacut.video/blog/guide" target="_blank" rel="noreferrer" className="font-bold text-[#ff9b8d] underline underline-offset-4">{ui("공식 서비스 가이드")}</a></li>
            <li>{ui("피카클립: ")}<a href="https://www.fikad.boo/" target="_blank" rel="noreferrer" className="font-bold text-[#ff9b8d] underline underline-offset-4">{ui("공식 홈페이지")}</a> · <a href="https://www.fikad.boo/pricing" target="_blank" rel="noreferrer" className="font-bold text-[#ff9b8d] underline underline-offset-4">{ui("공식 요금제")}</a></li>
          </ul>
          <p className="mt-6 text-xs leading-6 text-neutral-500">{ui("알파컷(AlphaCut)과 피카클립(FikaClip)은 각 소유자의 상표입니다. 이지컷은 두 서비스와 제휴하거나 공식적으로 연관되어 있지 않습니다. 각 서비스에는 서로 다른 강점과 적합한 사용 방식이 있으며, 본 비교는 공개정보를 이해하기 쉽게 정리한 참고 자료입니다. 특정 서비스의 우열이나 동일한 결과를 보장하지 않습니다.")}</p>
        </section>

        <section aria-labelledby="comparison-cta" className="mt-10 text-center">
          <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#ff9b8d]">Try Easy Cut</p>
          <h2 id="comparison-cta" className="mt-3 text-2xl font-black tracking-[-.035em] text-white sm:text-3xl">{ui("내 영상에 맞는지 직접 확인해보세요")}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-neutral-400">{ui("권리를 보유한 YouTube 영상 링크를 입력하면 예상 쇼츠 개수와 템플릿을 확인한 뒤 제작을 시작할 수 있습니다.")}</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/#workspace" className="inline-flex min-h-12 items-center rounded-xl bg-white px-6 text-sm font-black text-black hover:bg-neutral-200">{ui("이지컷으로 쇼츠 만들기")}</Link>
            <Link href="/pricing" className="inline-flex min-h-12 items-center rounded-xl border border-white/15 px-6 text-sm font-black text-white hover:border-white/30">{ui("요금제 보기")}</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
