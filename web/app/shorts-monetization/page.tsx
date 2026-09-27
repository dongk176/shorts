import {
  GuideExperience,
  StartQuizButton,
  BrowsePanel,
} from "./guide-experience";
import { textFor } from "@/lib/shorts-guides/catalog";
import { getStrategyLibraryAccess } from "@/lib/shorts-guides/library-access";
import { GuideLibrary } from "./guide-library";
import { GuideRecommendationProvider } from "./guide-recommendation";
import { getRequestLocale } from "@/lib/i18n/server";
import { localeTags, type SiteLocale } from "@/lib/i18n/config";
import { monetizationTranslator } from "./monetization-copy";
import type { Metadata, Viewport } from "next";
import Link from "@/lib/i18n/navigation";
import { localizedHref } from "@/lib/i18n/routing";
import Image from "next/image";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { AuthControls } from "@/components/auth-controls";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { authProfile } from "@/lib/session";
import { StructuredData } from "@/components/structured-data";
import { createPageMetadata, SITE_URL } from "@/lib/seo";
import { Icon } from "./icons";
import { MonetizationQuiz } from "./monetization-quiz";
import s from "./monetization.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = monetizationTranslator(locale);
  return createPageMetadata({
    locale,
    title: t("이지컷 쇼츠 수익화 가이드 | 나에게 맞는 방법 찾기"),
    description: t(
      "유튜브 쇼츠 광고 수익, 쿠팡 파트너스, 브랜드 협찬, 상품 판매를 비교하세요. 8가지 질문으로 내 콘텐츠와 하루 가용 시간에 맞는 시작 방법, 영상 아이디어와 실행 계획을 찾아보세요.",
    ),
    path: "/shorts-monetization",
    type: "article",
    image: {
      url: `${SITE_URL}/social/shorts-guide-${locale}-20260927-v2.jpg`,
      alt: t("유튜브 쇼츠 수익화, 나에게 맞는 방법 찾기"),
    },
  });
}
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101415",
};

function getMethods(locale: SiteLocale) {
  const t = monetizationTranslator(locale);
  return [
    {
      number: "01",
      id: "affiliate",
      photo: "affiliate-13250819",
      photoWidth: 2000,
      photoHeight: 3000,
      photographer: "Amar Preciado",
      photoSource:
        "https://www.pexels.com/photo/hands-opening-box-with-tripod-13250819/",
      photoPosition: "50% 52%",
      scene: t("써본 경험을 콘텐츠로"),
      alt: t("스마트폰 옆에서 짐벌 케이스를 열어 제품을 살펴보는 손"),
      icon: "bag",
      tag: t("구매에 도움이 되는 경험"),
      title: t("제휴 수익"),
      sub: t("쿠팡 파트너스 등"),
      text: t(
        "직접 써본 제품을 소개하고, 제휴 링크를 통한 구매가 발생하면 조건에 따라 수수료를 받아요.",
      ),
      fit: t("제품 리뷰 · 생활용품 · 뷰티"),
      first: t("사용해 본 제품과 구매 동선 준비"),
      note: t("수수료·정산·공개 표시 조건은 제휴 서비스에서 확인해요."),
      href:
        locale === "ko"
          ? "https://partners.coupang.com/"
          : `https://support.google.com/youtube/answer/13748639?hl=${locale}`,
      source: t("쿠팡 파트너스"),
    },
    {
      number: "02",
      id: "ads",
      photo: "ads-11025645",
      photoWidth: 2000,
      photoHeight: 1333,
      photographer: "Amar Preciado",
      photoSource:
        "https://www.pexels.com/photo/laptop-and-computer-on-the-desk-with-video-editing-11025645/",
      photoPosition: "68% 50%",
      scene: t("좋아하는 주제를 시리즈로"),
      alt: t("영상 편집 타임라인이 열린 모니터와 노트북이 있는 작업 책상"),
      icon: "play",
      tag: t("다시 찾아오는 시청자"),
      title: t("유튜브 광고 수익"),
      sub: t("YouTube 파트너 프로그램"),
      text: t(
        "콘텐츠로 시청자를 모으고, 유튜브의 신청 요건과 심사를 거쳐 광고 수익을 배분받아요.",
      ),
      fit: t("지식 · 게임 · 취미 · 인터뷰"),
      first: t("반복해서 볼 이유가 있는 시리즈"),
      note: t("팬 후원 기능과 광고 수익의 자격 조건은 서로 달라요."),
      href: `https://support.google.com/youtube/answer/72851?hl=${locale}`,
      source: t("유튜브 자격 요건"),
    },
    {
      number: "03",
      id: "sponsor",
      photo: "sponsor-korean-v2",
      photoWidth: 1024,
      photoHeight: 1536,
      photographer: t("Ron Lach 원본 · 한국인 인물 AI 편집"),
      photoSource:
        "https://www.pexels.com/photo/woman-showing-a-beauty-product-8154664/",
      photoPosition: "50% 50%",
      scene: t("나의 취향을 브랜드와"),
      alt: t("스마트폰 화면 속에서 화장품을 보여주며 리뷰를 촬영하는 모습"),
      icon: "spark",
      tag: t("브랜드와 맞닿는 콘텐츠"),
      title: t("브랜드 협찬·광고"),
      sub: t("브랜드와의 직접 협업"),
      text: t(
        "내 채널의 주제와 시청자에 맞는 브랜드와 협업해 제품이나 서비스를 소개해요.",
      ),
      fit: t("명확한 주제 · 꾸준한 시청자 반응"),
      first: t("대표 콘텐츠와 채널 소개서 준비"),
      note: t("제품 제공과 현금 지급을 구분하고 제작·활용 범위를 협의해요."),
      href: `https://support.google.com/youtube/answer/154235?hl=${locale}`,
      source: t("유료 프로모션 안내"),
    },
    {
      number: "04",
      id: "sales",
      photo: "sales-6611403",
      photoWidth: 2000,
      photoHeight: 1335,
      photographer: "Yan Krukau",
      photoSource:
        "https://www.pexels.com/photo/hands-of-a-potter-working-with-clay-on-a-pottery-wheel-6611403/",
      photoPosition: "52% 50%",
      scene: t("나만의 전문성을 기회로"),
      alt: t("작업실의 물레 위에서 손으로 도자기를 빚는 모습"),
      icon: "store",
      tag: t("작은 신뢰에서 시작하는 구매"),
      title: t("내 상품·서비스 판매"),
      sub: t("상품 · 강의 · 상담"),
      text: t(
        "고객의 질문에 답하는 쇼츠로 신뢰를 쌓고, 더 도움이 필요한 사람을 상품이나 상담으로 연결해요.",
      ),
      fit: t("전문 지식 · 자기 상품 · 서비스"),
      first: t("고객 질문 하나와 연결할 페이지"),
      note: t("판매할 것이 없다면 시청자의 문제와 관심부터 확인해요."),
      href: `https://support.google.com/youtube/answer/13748639?hl=${locale}`,
      source: t("시청자와 링크 공유"),
    },
  ];
}
function getFaqs(locale: SiteLocale) {
  const t = monetizationTranslator(locale);
  return [
    {
      q: t("구독자가 적어도 수익화를 준비할 수 있나요?"),
      a: t(
        "네. 광고 수익 신청을 준비하는 것과 제휴·협찬·자기 상품 판매를 준비하는 것은 다른 경로예요. 구독자 수만으로 모든 방법이 결정되지는 않아요. 각 서비스의 조건을 확인하고, 내 콘텐츠를 볼 사람과 제공할 가치부터 정해보세요.",
      ),
    },
    {
      q: t("유튜브 쇼츠 조회수 100만이면 얼마를 버나요?"),
      a: t(
        "조회수에 고정 금액을 곱해 수입을 단정할 수는 없어요. 광고 수익은 수익 창출 대상 여부와 시청자·지역 등 여러 요인에 따라 달라지고, 제휴·상품 판매는 실제 구매 전환에 따라 달라져요. 이 가이드는 예상 수익 대신 실행 방향을 안내해요.",
      ),
    },
    {
      q: t("얼굴을 공개하지 않아도 시작할 수 있나요?"),
      a: t(
        "제품을 쓰는 손, 직접 녹화한 게임·작업 화면, 내 목소리 설명처럼 여러 방식이 있어요. 얼굴 출연보다 시청자가 얻는 정보와 내 콘텐츠만의 설명이 무엇인지 먼저 생각해 보세요.",
      ),
    },
    {
      q: t("다른 사람의 영상을 편집하면 수익화가 되나요?"),
      a: t(
        "편집·상업적 이용 권한을 먼저 확인해야 해요. 권한이 있더라도 유튜브의 수익 창출 심사는 별개이며, 단순 재편집만으로 승인이 보장되지 않아요. 자신의 해설이나 창의적 가치가 무엇인지도 살펴야 해요.",
      ),
      href: `https://support.google.com/youtube/answer/1311392?hl=${locale}`,
      label: t("유튜브 수익 창출 정책"),
    },
    {
      q: t("쿠팡 파트너스 링크는 쇼츠 어디에 넣나요?"),
      a: t(
        "쇼츠 설명과 댓글에 적은 URL은 클릭되지 않아요. 채널 프로필 등 클릭 가능한 위치로 안내하고 실제 구매 동선을 직접 확인해 보세요. 외부 제휴 링크와 YouTube Shopping 상품 태그는 서로 다른 기능이며 조건도 따로 확인해야 해요.",
      ),
      href: `https://support.google.com/youtube/answer/13748639?hl=${locale}`,
      label: t("유튜브 링크 안내"),
    },
    {
      q: t("이지컷으로 만들면 수익화가 자동으로 되나요?"),
      a: t(
        "이지컷은 원본의 하이라이트를 찾고 쇼츠를 편집하는 과정을 도와줘요. 수익화 승인과 실제 수입은 콘텐츠, 플랫폼 정책, 시청자 반응 등에 따라 달라져요. AI 사용 여부만으로 수익화 가능 여부가 결정되는 것은 아니에요.",
      ),
      href: `https://support.google.com/youtube/answer/1311392?hl=${locale}`,
      label: t("콘텐츠 정책 확인하기"),
    },
    {
      q: t("매일 시간을 내기 어려우면 어떻게 하나요?"),
      a: t(
        "소재 선택, 촬영, 편집을 여러 날에 나누거나 주말에 묶어서 진행해 보세요. 설문에서 하루 가용 시간 또는 주말 집중형을 선택하면 그에 맞는 시작 계획을 볼 수 있어요. 처음에는 실제 작업 시간을 재보며 일정을 조정하세요.",
      ),
    },
  ];
}

export default async function MonetizationPage() {
  const [user, locale] = await Promise.all([
    getAuthenticatedUser(),
    getRequestLocale(),
  ]);
  const guideAccess = await getStrategyLibraryAccess(user);
  const t = monetizationTranslator(locale);
  const l = (ko: string, en: string, ja: string) =>
    textFor([ko, en, ja], locale);
  const methods = getMethods(locale);
  const faqs = getFaqs(locale);
  return (
    <div
      className={`app-shell site-chrome desktop-sidebar-layout home-desktop-sidebar ${s.page}`}
      lang={locale}
      data-i18n-skip
    >
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: t("유튜브 쇼츠 수익화, 나에게 맞는 방법 찾기"),
          description: t("맞춤 설문과 수익화 방식별 시작 가이드"),
          inLanguage: localeTags[locale],
          image: `${SITE_URL}/social/shorts-guide-${locale}-20260927-v2.jpg`,
          mainEntityOfPage: `${SITE_URL}${localizedHref("/shorts-monetization", locale)}`,
          author: { "@id": `${SITE_URL}/#organization` },
          publisher: { "@id": `${SITE_URL}/#organization` },
        }}
      />
      <StructuredData
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: t("이지컷"),
              item: `${SITE_URL}${localizedHref("/", locale)}`,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: t("쇼츠 가이드"),
              item: `${SITE_URL}${localizedHref("/shorts-monetization", locale)}`,
            },
          ],
        }}
      />
      <a href="#main-content" className={s.skipLink}>
        {t("본문으로 바로가기")}
      </a>
      <SiteHeader desktopSidebar>
        <AuthControls
          user={user ? authProfile(user) : null}
          next="/shorts-monetization"
        />
      </SiteHeader>
      <main id="main-content" className={s.main}>
        <GuideRecommendationProvider>
          <GuideExperience>
            <div className={s.content}>
              <div className={s.heroLayout}>
                <section className={s.hero} aria-labelledby="hero-title">
                  <span className={s.heroLabel}>{t("쇼츠 가이드")}</span>
                  <h1 id="hero-title" className="hero-title">
                    {t("쇼츠 수익화,")}
                    <br />
                    <span>{t("나에게 맞는 방법부터.")}</span>
                  </h1>
                  <p>
                    {t(
                      "콘텐츠와 하루 가용 시간에 맞는 수익화 방법을 찾아보세요.",
                    )}
                    <br className={s.desktopOnly} />{" "}
                    {t("첫 영상 아이디어와 시작 계획까지 안내합니다.")}
                  </p>
                  <StartQuizButton />
                </section>
                <div
                  className={s.sceneGallery}
                  aria-label={t("콘텐츠로 시작하는 네 가지 수익화 방법")}
                >
                  {methods.map((method, index) => (
                    <a
                      className={s.sceneCard}
                      href={`#method-${method.id}`}
                      key={method.id}
                    >
                      <span className={s.sceneThumbnail}>
                        <Image
                          src={`/images/monetization/${method.photo}.webp`}
                          alt=""
                          fill
                          quality={90}
                          style={{ objectPosition: method.photoPosition }}
                          priority={index < 2}
                          sizes="(max-width: 767px) 260px, 360px"
                        />
                      </span>
                      <span className={s.sceneCaption}>
                        <strong>{method.title}</strong>
                        <small>{method.sub}</small>
                      </span>
                    </a>
                  ))}
                </div>
              </div>
              <nav
                className={s.sectionNav}
                aria-label={t("수익화 가이드 목차")}
              >
                <StartQuizButton compact />
                <a href="#ways">{t("수익화 방법")}</a>
                <a href="#shooting-checklist">{t("제작 준비")}</a>
                <a href="#questions">{t("자주 묻는 질문")}</a>
                <a href="#guide-library">
                  {l("실행북", "Workbooks", "実践ブック")}
                </a>
              </nav>
              <MonetizationQuiz />
              <BrowsePanel
                target="ways"
                title={l(
                  "수익화 방법 비교",
                  "Compare ways to earn",
                  "収益化の方法を比べる",
                )}
                description={l(
                  "네 가지 방법, 내 콘텐츠와 비교해보세요",
                  "Four routes, compared with your content",
                  "四つの方法を、自分の動画と比べよう",
                )}
              >
                <section
                  id="ways"
                  className={s.guideSection}
                  aria-labelledby="ways-title"
                >
                  <div className={s.sectionHeading}>
                    <div>
                      <span className={s.eyebrow}>{t("수익화 방법")}</span>
                      <h2 id="ways-title">
                        {t("쇼츠 수익화, 이렇게 시작합니다")}
                      </h2>
                    </div>
                    <p>
                      {t("광고 수익부터 제휴, 협찬, 직접 판매까지.")}
                      <br />
                      {t("내 콘텐츠와 연결할 수 있는 방법을 확인하세요.")}
                    </p>
                  </div>
                  <div className={s.methodGrid}>
                    {methods.map((method) => (
                      <article
                        id={`method-${method.id}`}
                        key={method.number}
                        className={s.methodCard}
                      >
                        <details className={s.methodDisclosure}>
                          <summary className={s.methodOverview}>
                            <div className={s.compareTitle}>
                              <strong>{method.title}</strong>
                              <span aria-hidden="true">＋</span>
                            </div>
                            <span className={s.compareIncome}>
                              {method.sub}
                            </span>
                            <dl>
                              <dt>{t("추천 콘텐츠")}</dt>
                              <dd>{method.fit}</dd>
                              <dt>{t("시작 전 준비")}</dt>
                              <dd>{method.first}</dd>
                            </dl>
                            <span className={s.compareMore}>
                              {l(
                                "사진과 자세한 설명 보기",
                                "View photo & details",
                                "写真と詳しい説明を見る",
                              )}
                            </span>
                          </summary>
                          <div className={s.methodHeader}>
                            <div className={s.methodPhoto}>
                              <Image
                                src={`/images/monetization/${method.photo}.webp`}
                                alt={method.alt}
                                width={method.photoWidth}
                                height={method.photoHeight}
                                quality={90}
                                style={{ objectPosition: method.photoPosition }}
                                sizes="(max-width: 767px) calc(100vw - 34px), 500px"
                              />
                            </div>
                            <div className={s.methodContent}>
                              <div className={s.methodTitle}>
                                <span className={s.methodNumber}>
                                  {method.number} · {method.scene}
                                </span>
                                <h3>{method.title}</h3>
                                <span className={s.methodSub}>
                                  {method.sub}
                                </span>
                              </div>
                              <div className={s.methodBody}>
                                <p className={s.methodText}>{method.text}</p>
                                <dl className={s.methodDetail}>
                                  <dt>{t("추천 콘텐츠")}</dt>
                                  <dd>{method.fit}</dd>
                                  <dt>{t("시작 전 준비")}</dt>
                                  <dd>{method.first}</dd>
                                </dl>
                                <p className={s.methodNote}>{method.note}</p>
                                <a
                                  href={method.href}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {method.source}
                                  <span aria-hidden="true">↗</span>
                                  <span className={s.srOnly}>
                                    {t("(새 창)")}
                                  </span>
                                </a>
                              </div>
                            </div>
                          </div>
                        </details>
                      </article>
                    ))}
                  </div>
                  <details className={s.photoCredit}>
                    <summary>
                      {t("콘텐츠 제작 예시 이미지 · 출처 보기")}
                    </summary>
                    <ul>
                      {methods.map((method) => (
                        <li key={method.id}>
                          <a
                            href={method.photoSource}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {method.title} — {method.photographer}
                            <span className={s.srOnly}>
                              {t("(사진 출처, 새 창)")}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className={s.fanNote}>
                    <Icon name="smile" size={21} />
                    <p>
                      <strong>
                        {t("후원·멤버십으로도 확장할 수 있습니다.")}
                      </strong>
                      <br />
                      {t(
                        "팬에게 꾸준히 제공할 가치를 정하고, 기능별 이용 조건을 확인하세요.",
                      )}
                    </p>
                    <a
                      href={`https://support.google.com/youtube/answer/13429240?hl=${locale}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t("유튜브 팬 후원 조건 확인 (새 창)")}
                    >
                      <Icon name="arrow" size={20} />
                    </a>
                  </div>
                </section>
              </BrowsePanel>
              <BrowsePanel
                target="shooting-checklist"
                title={l("첫 촬영 준비", "Before you film", "最初の撮影の準備")}
                description={l(
                  "원본이 없어도, 세 가지만 준비하면 돼요",
                  "Three things to prepare before filming",
                  "素材がなくても、まずは三つの準備から",
                )}
              >
                <section
                  id="shooting-checklist"
                  className={s.shooting}
                  aria-labelledby="shooting-title"
                >
                  <div>
                    <span className={s.eyebrow}>{t("제작 준비")}</span>
                    <h2 id="shooting-title">
                      {t("첫 영상에 필요한")} <br />
                      {t("세 가지")}
                    </h2>
                    <p>{t("촬영 전에 먼저 정리해 보세요.")}</p>
                  </div>
                  <ol>
                    {[
                      [
                        t("전할 이야기"),
                        t(
                          "누구의 어떤 궁금증을 풀어줄지 한 문장으로 정리하세요.",
                        ),
                      ],
                      [
                        t("사용할 원본"),
                        t(
                          "시작, 과정, 결과가 담긴 장면을 준비하세요. 영상의 이용 권한과 공개 가능한 정보도 확인합니다.",
                        ),
                      ],
                      [
                        t("시청자의 다음 행동"),
                        t(
                          "다음 편 보기, 관련 정보 확인, 질문 남기기 중 하나를 정하세요.",
                        ),
                      ],
                    ].map(([title, detail], index) => (
                      <li key={title}>
                        <span>0{index + 1}</span>
                        <div>
                          <h3>{title}</h3>
                          <p>{detail}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              </BrowsePanel>
              <BrowsePanel
                target="questions"
                title={t("자주 묻는 질문")}
                description={l(
                  "시작 전에 궁금했던 것들",
                  "A few things you may be wondering",
                  "始める前の気になること",
                )}
              >
                <section
                  id="questions"
                  className={s.faqSection}
                  aria-labelledby="faq-title"
                >
                  <div className={s.sectionHeading}>
                    <div>
                      <span className={s.eyebrow}>{t("자주 묻는 질문")}</span>
                      <h2 id="faq-title">{t("시작 전 확인하세요")}</h2>
                    </div>
                  </div>
                  <div className={s.faqList}>
                    {faqs.map((faq) => (
                      <details key={faq.q}>
                        <summary>
                          <h3>{faq.q}</h3>
                          <span className={s.faqPlus} aria-hidden="true" />
                        </summary>
                        <div>
                          <p>{faq.a}</p>
                          {faq.href ? (
                            <a href={faq.href} target="_blank" rel="noreferrer">
                              {faq.label} ↗
                              <span className={s.srOnly}>{t("(새 창)")}</span>
                            </a>
                          ) : null}
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              </BrowsePanel>
              <BrowsePanel
                target="guide-library"
                title={l(
                  "실행북 둘러보기",
                  "Explore the workbooks",
                  "実践ブックを見てみよう",
                )}
                description={l(
                  "5권의 목차와 표지를 무료로 미리 보세요",
                  "Preview the contents and covers of all five books",
                  "全5冊の目次と表紙を無料でチェック",
                )}
              >
                <GuideLibrary access={guideAccess} />
              </BrowsePanel>
              <section className={s.closing}>
                <h2>
                  {t("방향을 정했다면,")}
                  <br />
                  <span>{t("첫 쇼츠를 만들어보세요.")}</span>
                </h2>
                <p>
                  {t(
                    "내 영상에서 하이라이트를 찾고, 제목과 자막을 편집하세요.",
                  )}
                </p>
                <Link prefetch={false} href="/" className={s.primaryButton}>
                  {t("이지컷으로 쇼츠 만들기")}
                  <Icon name="arrow" size={18} />
                </Link>
                <div className={s.related}>
                  <Link prefetch={false} href="/guidebook">
                    {t("채널 운영 가이드북 ↗")}
                  </Link>
                  <Link prefetch={false} href="/ai-shorts-maker">
                    {t("이지컷 사용 방법 ↗")}
                  </Link>
                </div>
              </section>
              <div className={s.editorialNote}>
                <span>{t("이지컷 운영팀 · 가이드 확인 2026.09.27")}</span>
                <p>
                  {t(
                    "실행 방향을 돕는 가이드이며 수익이나 수익화 승인을 보장하지 않습니다. 플랫폼 정책과 서비스 조건은 신청 전 공식 안내를 확인하세요.",
                  )}
                </p>
              </div>
            </div>
          </GuideExperience>
        </GuideRecommendationProvider>
      </main>
      <SiteFooter />
    </div>
  );
}
