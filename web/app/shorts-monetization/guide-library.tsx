"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "@/lib/i18n/navigation";
import { localizedHref } from "@/lib/i18n/routing";
import { useI18n } from "@/lib/i18n/provider";
import {
  guideCatalog,
  guideSlugs,
  textFor,
  type GuideSlug,
} from "@/lib/shorts-guides/catalog";
import { useGuideRecommendation } from "./guide-recommendation";
import { GuidePreview } from "./guide-preview";
import { trackGuideEvent } from "@/lib/shorts-analytics/client";
import s from "./monetization.module.css";
export type GuideAccess = "paid" | "free" | "guest" | "unavailable";
export function GuideLibrary({ access }: { access: GuideAccess }) {
  const { recommended } = useGuideRecommendation();
  const { locale } = useI18n();
  const [busy, setBusy] = useState<GuideSlug | null>(null);
  const [preview, setPreview] = useState<GuideSlug | null>(null);
  const [error, setError] = useState("");
  const l = (ko: string, en: string, ja: string) =>
    textFor([ko, en, ja], locale);
  const slugs = recommended
    ? [recommended, ...guideSlugs.filter((s) => s !== recommended)]
    : guideSlugs;
  async function download(slug: GuideSlug) {
    if (busy) return;
    trackGuideEvent({
      name: "result_action",
      action: "download_attempt",
      locale,
      guide: slug,
    });
    setBusy(slug);
    setError("");
    try {
      const res = await fetch(
        `/api/shorts-guides/${slug}/download?lang=${locale}`,
        { cache: "no-store" },
      );
      if (!res.ok)
        throw new Error(
          res.status === 401
            ? l(
                "로그인 후 다시 내려받아 주세요.",
                "Please sign in and try again.",
                "ログインしてから、もう一度お試しください。",
              )
            : res.status === 403
              ? l(
                  "현재 이용 중인 유료 플랜이 필요해요. 플랜 상태를 확인해 주세요.",
                  "An active paid plan is required. Please check your plan.",
                  "利用中の有料プランが必要です。プランをご確認ください。",
                )
              : l(
                  "다운로드를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
                  "Couldn’t prepare the download. Please try again shortly.",
                  "ダウンロードを準備できませんでした。少し待って再度お試しください。",
                ),
        );
      const blob = await res.blob();
      trackGuideEvent({
        name: "result_action",
        action: "download_success",
        locale,
        guide: slug,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `EasyCut-${slug}-${locale}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : l(
              "다시 시도해 주세요.",
              "Please try again.",
              "もう一度お試しください。",
            ),
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      id="guide-library"
      className={s.guideLibrary}
      aria-labelledby="library-title"
    >
      <div className={s.sectionHeading}>
        <div>
          <span className={s.eyebrow}>
            {l(
              "이지컷 유료 고객 전용 실행북",
              "EasyCut paid-plan workbooks",
              "EasyCut有料プランの実践ブック",
            )}
          </span>
          <h2 id="library-title">
            {recommended
              ? l(
                  "내 전략을 실행으로 옮기는 책",
                  "Put your strategy into practice",
                  "自分の戦略を、実践するために",
                )
              : l(
                  "읽고, 따라 하고, 첫 쇼츠까지",
                  "Read it. Try it. Make your Short.",
                  "読んで、試して、最初のショートへ",
                )}
          </h2>
        </div>
        <p>
          {l(
            "5권 · 각 13페이지 · 한국어·영어·일본어 PDF\n목차와 표지 미리보기는 누구나 볼 수 있어요.",
            "5 books · 13 pages each · Korean, English & Japanese PDFs\nAnyone can preview the contents and covers.",
            "全5冊・各13ページ・韓国語／英語／日本語PDF\n目次と表紙のプレビューは、どなたでも読めます。",
          )}
        </p>
      </div>
      <p className={s.libraryPolicy}>
        {l(
          "이 실행북 시리즈는 이용 기간이 유효한 유료 플랜에 포함됩니다. 기존 요금제 전자책과는 별도 구성입니다. 수익이나 플랫폼 승인을 보장하지 않아요.",
          "This collection is included while your paid plan is active. It is separate from the existing package ebook collection. It does not guarantee earnings or platform approval.",
          "このシリーズは有料プランの有効期間中に利用できます。従来のパッケージ電子書籍とは別の内容です。収益や審査の承認を保証するものではありません。",
        )}
      </p>
      <div className={s.collectionOffer}>
        <div>
          <strong>
            {l(
              "유료 플랜 하나로, 실행북 5권 모두",
              "One paid plan. All five workbooks.",
              "有料プランひとつで、全5冊を。",
            )}
          </strong>
          <p>
            {l(
              "따로 구매할 필요 없어요. 미리 읽어보고 나에게 필요한지 확인해 보세요.",
              "No separate book purchase needed. Take a look inside and see what works for you.",
              "本ごとの購入は不要です。まずはサンプルで、自分に合うか見てみてください。",
            )}
          </p>
        </div>
        {(access === "guest" || access === "free") && (
          <Link
            prefetch={false}
            href="/pricing?from=shorts-monetization"
            onClick={() => trackGuideEvent({ name: "pricing_clicked", locale })}
            className={s.nextButton}
          >
            {l(
              "포함된 플랜 살펴보기",
              "Explore paid plans",
              "対象のプランを見る",
            )}
          </Link>
        )}
      </div>
      {access === "guest" && (
        <p className={s.libraryPolicy}>
          {l(
            "이미 유료 고객이신가요?",
            "Already on a paid plan?",
            "すでに有料プランをご利用ですか？",
          )}{" "}
          <Link
            prefetch={false}
            href={`/auth/sign-in?next=${encodeURIComponent(localizedHref("/shorts-monetization#guide-library", locale))}`}
          >
            {l(
              "로그인하고 내려받기",
              "Sign in to download",
              "ログインしてダウンロード",
            )}
          </Link>
        </p>
      )}
      <div className={s.bookGrid}>
        {slugs.map((slug) => {
          const book = guideCatalog[slug];
          return (
            <article
              key={slug}
              className={`${s.bookCard} ${recommended === slug ? s.recommendedBook : ""}`}
            >
              <div className={s.bookIntro}>
                <Image
                  src={`/shorts-guide-previews/${locale}/${slug}-cover.jpg?v=20260927-editorial-2`}
                  alt={textFor(book.title, locale)}
                  width={420}
                  height={595}
                  sizes="110px"
                />
                <div>
                  {recommended === slug && (
                    <span className={s.bookBadge}>
                      {l(
                        "내 답변에 맞는 첫 책",
                        "Start here for your answers",
                        "回答に合う、最初の1冊",
                      )}
                    </span>
                  )}
                  <h3>{textFor(book.title, locale)}</h3>
                  <p>{textFor(book.subtitle, locale)}</p>
                </div>
              </div>
              <p className={s.bookOutcome}>{textFor(book.outcome, locale)}</p>
              <button
                type="button"
                className={s.previewButton}
                onClick={() => {
                  setError("");
                  trackGuideEvent({
                    name: "guide_preview",
                    locale,
                    guide: slug,
                  });
                  setPreview(slug);
                }}
              >
                {l(
                  "목차와 표지 미리보기",
                  "Contents & cover preview",
                  "目次と表紙のプレビュー",
                )}
                <span aria-hidden="true">↗</span>
              </button>
              {access === "paid" || access === "unavailable" ? (
                <button
                  type="button"
                  className={s.nextButton}
                  disabled={busy !== null}
                  onClick={() => void download(slug)}
                >
                  {busy === slug
                    ? l("준비 중…", "Preparing…", "準備中…")
                    : l(
                        "전체 PDF 내려받기",
                        "Download full PDF",
                        "PDF全文をダウンロード",
                      )}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
      {access === "unavailable" && (
        <p role="status">
          {l(
            "플랜 상태를 불러오지 못했어요. 다운로드 시 이용 권한을 다시 확인합니다.",
            "We couldn’t load your plan. Your access will be checked again when you download.",
            "プランを読み込めませんでした。ダウンロード時に利用権限を再確認します。",
          )}
        </p>
      )}
      <p role="status" className={s.guideError}>
        {error}
      </p>
      {preview && (
        <GuidePreview
          slug={preview}
          access={access}
          busy={busy !== null}
          error={error}
          onClose={() => setPreview(null)}
          onDownload={() => void download(preview)}
        />
      )}
    </section>
  );
}
