"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "@/lib/i18n/navigation";
import { useI18n } from "@/lib/i18n/provider";
import {
  guideCatalog,
  analyticsGuide,
  guideCoverSrc,
  textFor,
  type GuideSlug,
} from "@/lib/shorts-guides/catalog";
import type { GuideAccess } from "./guide-library";
import { trackGuideEvent } from "@/lib/shorts-analytics/client";
import s from "./monetization.module.css";

export function GuidePreview({
  slug,
  access,
  busy,
  error,
  onClose,
  onDownload,
}: {
  slug: GuideSlug;
  access: GuideAccess;
  busy: boolean;
  error: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const { locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const book = guideCatalog[slug];
  const l = (ko: string, en: string, ja: string) =>
    textFor([ko, en, ja], locale);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    close.current?.focus();
    return () => {
      node.close();
      document.body.style.overflow = previousOverflow;
      opener?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={s.previewDialog}
      aria-labelledby="book-preview-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={s.previewSurface}>
        <header>
          <h2 id="book-preview-title">{textFor(book.title, locale)}</h2>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            aria-label={l(
              "미리보기 닫기",
              "Close preview",
              "プレビューを閉じる",
            )}
          >
            ✕
          </button>
        </header>
        <div className={`${s.previewScroll} ${s.coverLayout}`}>
          <div className={s.previewContents}>
            <p>{textFor(book.outcome, locale)}</p>
            <ol>
              {book.chapters.map((chapter) => (
                <li key={chapter[0]}>{textFor(chapter, locale)}</li>
              ))}
              {!book.language && <li>
                {l(
                  "이지컷 실습 · 시간별 계획 · 기록지 · FAQ",
                  "EasyCut practice · schedules · worksheet · FAQ",
                  "EasyCut実習・時間別プラン・記録シート・FAQ",
                )}
              </li>}
            </ol>
          </div>
          <div className={s.previewArtwork}>
            <div className={s.previewToolbar}>
              <span>
                {l("표지 미리보기", "Cover preview", "表紙のプレビュー")}
              </span>
              <button
                type="button"
                aria-pressed={zoomed}
                onClick={() => setZoomed(!zoomed)}
              >
                {zoomed
                  ? l("화면에 맞추기", "Fit to screen", "画面に合わせる")
                  : l("크게 보기", "Zoom in", "拡大する")}
              </button>
            </div>
            <div className={s.sampleViewport}>
              <Image
                src={guideCoverSrc(slug, locale)}
                alt={l("실행북 표지", "Workbook cover", "実践ブックの表紙")}
                width={840}
                height={book.language ? 1295 : 1190}
                sizes={zoomed ? "1100px" : "(max-width: 767px) 100vw, 480px"}
                className={zoomed ? s.zoomedSample : s.fitSample}
              />
            </div>
          </div>
        </div>
        <footer>
          <span>
            {book.language ? l(
              "전체 12페이지 · 한국어 PDF · 유료 플랜에 포함",
              "12 pages · Korean PDF · Included with a paid plan",
              "全12ページ・韓国語PDF・有料プランに含まれます",
            ) : l(
              "전체 13페이지 · 유료 플랜에 포함",
              "13 pages · Included with a paid plan",
              "全13ページ・有料プランに含まれます",
            )}
          </span>
          {access === "paid" || access === "unavailable" ? (
            <button
              type="button"
              className={s.nextButton}
              disabled={busy}
              onClick={onDownload}
            >
              {busy
                ? l("준비 중…", "Preparing…", "準備中…")
                : l(
                    "전체 PDF 내려받기",
                    "Download full PDF",
                    "PDF全文をダウンロード",
                  )}
            </button>
          ) : (
            <Link
              prefetch={false}
              href="/pricing?from=shorts-monetization"
              onClick={() =>
                trackGuideEvent({
                  name: "pricing_clicked",
                  locale,
                  guide: analyticsGuide(slug),
                })
              }
              className={s.nextButton}
            >
              {l(
                "포함된 플랜 살펴보기",
                "Explore paid plans",
                "対象のプランを見る",
              )}
            </Link>
          )}
          <p role="status">{error}</p>
        </footer>
      </div>
    </dialog>
  );
}
