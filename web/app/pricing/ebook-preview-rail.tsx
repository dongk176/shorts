"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n/provider";
import { translateLegacyText } from "@/lib/i18n/legacy-phrases";
import type { SiteLocale } from "@/lib/i18n/config";
import { useEffect, useRef, useState } from "react";
import {
  PaymentMessageOverlay,
  type PaymentMessageTone,
} from "@/components/payment-message-overlay";
import { SHOW_MONETIZATION_CONTENT } from "@/lib/content-visibility";

type Ebook = {
  slug: string;
  title: string;
  pageCount: number;
  pageHeight: number;
  monetizationRelated?: boolean;
};

type DownloadMessage = {
  message: string;
  remaining: number | null;
  title: string;
  tone: PaymentMessageTone;
};

const ebooks = [
  { slug: "monetization-7", title: "쇼츠 수익화 7가지 방법", pageCount: 36, pageHeight: 2829, monetizationRelated: true },
  { slug: "multi-platform", title: "유튜브·릴스·틱톡 동시 공략법", pageCount: 36, pageHeight: 2829 },
  { slug: "copyright-survival", title: "쇼츠 저작권 생존 가이드", pageCount: 36, pageHeight: 2829 },
  { slug: "monetization-playbook", title: "숏폼 수익화 실전 가이드", pageCount: 20, pageHeight: 2589, monetizationRelated: true },
  { slug: "viral-formula", title: "조회수 터지는 쇼츠의 공식", pageCount: 36, pageHeight: 2829 },
  { slug: "low-views-diagnosis", title: "조회수가 안 나오는 쇼츠 진단서", pageCount: 36, pageHeight: 2829 },
  { slug: "title-300", title: "클릭을 부르는 쇼츠 제목 300선", pageCount: 36, pageHeight: 2829 },
] satisfies readonly Ebook[];

const visibleEbooks = SHOW_MONETIZATION_CONTENT
  ? ebooks
  : ebooks.filter((book) => !book.monetizationRelated);

const previewPages = [1, 2, 3] as const;

function pageImage(slug: string, page: number) {
  const qualitySuffix = page <= 3 ? "-hq" : "";
  return `/ebook-previews/${slug}/page-${String(page).padStart(2, "0")}${qualitySuffix}.jpg`;
}

function downloadName(contentDisposition: string | null, fallback: string) {
  const encodedName = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encodedName) return fallback;
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return fallback;
  }
}

async function downloadErrorMessage(response: Response, locale: SiteLocale, fallback: string) {
  const body = await response.json().catch(() => null) as { detail?: unknown } | null;
  if (typeof body?.detail !== "string") return fallback;
  const message = translateLegacyText(body.detail, locale);
  return locale !== "ko" && /[가-힣]/.test(message) ? fallback : message;
}

export function EbookPreviewRail({
  canDownload,
  onChoosePackage,
  description,
}: {
  canDownload: boolean;
  onChoosePackage: () => void;
  description?: string;
}) {
  const { locale, t } = useI18n();
  const bookTitle = (book: Ebook) => translateLegacyText(book.title, locale);
  const [activeBook, setActiveBook] = useState<Ebook | null>(null);
  const [downloadingSlug, setDownloadingSlug] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<DownloadMessage | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const yearlyCtaRef = useRef<HTMLButtonElement>(null);
  const activeTriggerRef = useRef<HTMLButtonElement>(null);
  const downloadInProgressRef = useRef(false);

  useEffect(() => {
    if (!activeBook) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveBook(null);
        window.setTimeout(() => activeTriggerRef.current?.focus(), 0);
      }
      if (event.key === "Tab") {
        const focusable = [yearlyCtaRef.current, closeButtonRef.current]
          .filter((item): item is HTMLButtonElement => item !== null);
        const currentIndex = focusable.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = currentIndex < 0
          ? 0
          : (currentIndex + direction + focusable.length) % focusable.length;
        focusable[nextIndex]?.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnKeyboard);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnKeyboard);
    };
  }, [activeBook]);

  const closePreview = () => {
    setActiveBook(null);
    window.setTimeout(() => activeTriggerRef.current?.focus(), 0);
  };

  const choosePackage = () => {
    setActiveBook(null);
    onChoosePackage();
  };

  const scrollRail = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * Math.min(rail.clientWidth * 0.82, 720), behavior: "smooth" });
  };

  const downloadEbook = async (book: Ebook) => {
    if (downloadInProgressRef.current) return;
    downloadInProgressRef.current = true;
    setDownloadingSlug(book.slug);
    setDownloadMessage(null);

    try {
      const response = await fetch(
        `/api/ebooks/${encodeURIComponent(book.slug)}/download`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await downloadErrorMessage(response, locale, t("ebook.error")));
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadName(
        response.headers.get("content-disposition"),
        `Easy_Cut_${book.title}.pdf`,
      );
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);

      const remainingHeader = response.headers.get("x-ebook-downloads-remaining");
      const parsedRemaining = remainingHeader === null ? Number.NaN : Number(remainingHeader);
      const remaining = Number.isInteger(parsedRemaining) && parsedRemaining >= 0
        ? parsedRemaining
        : null;
      setDownloadMessage({
        message: remaining === null
          ? t("ebook.downloadStartedMessage")
          : remaining === 0
            ? t("ebook.noneRemaining")
            : t("ebook.remainingMessage", { count: remaining }),
        remaining,
        title: t("ebook.downloadStarted"),
        tone: "success",
      });
    } catch (error) {
      setDownloadMessage({
        message: error instanceof Error
          ? error.message
          : t("ebook.error"),
        remaining: null,
        title: t("ebook.errorTitle"),
        tone: "error",
      });
    } finally {
      downloadInProgressRef.current = false;
      setDownloadingSlug(null);
    }
  };

  return (
    <>
      <section className="pricing-ebooks" aria-labelledby="ebook-preview-heading">
        <div className="ebook-rail-heading">
          <div>
            <h2 id="ebook-preview-heading">{t("ebook.heading")}</h2>
            <p style={{ whiteSpace: "pre-line" }}>{description ? translateLegacyText(description, locale) : t("ebook.description")}</p>
            {locale !== "ko" && <p className="font-semibold text-amber-100">{t("ebook.languageNotice")}</p>}
            <p>{t(canDownload ? "ebook.downloadHint" : "ebook.previewHint")}</p>
          </div>
          <div className="ebook-rail-actions" aria-label={t("ebook.navigation")}>
            <button type="button" onClick={() => scrollRail(-1)} aria-label={t("ebook.previous")}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <button type="button" onClick={() => scrollRail(1)} aria-label={t("ebook.next")}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          </div>
        </div>

        <div ref={railRef} className="ebook-rail" aria-label={t("ebook.list")}>
          {visibleEbooks.map((book) => (
            <button
              key={book.slug}
              type="button"
              className="ebook-card"
              disabled={canDownload && downloadingSlug !== null}
              aria-busy={downloadingSlug === book.slug}
              aria-label={t(canDownload ? "ebook.downloadLabel" : "ebook.previewLabel", { title: bookTitle(book) })}
              onClick={(event) => {
                if (canDownload) {
                  void downloadEbook(book);
                  return;
                }
                activeTriggerRef.current = event.currentTarget;
                setActiveBook(book);
              }}
            >
              <span className="ebook-card-title">
                {downloadingSlug === book.slug ? t("ebook.preparing") : bookTitle(book)}
              </span>
              <span className="mb-2 block w-full text-center text-xs text-neutral-400">
                {t(canDownload ? "ebook.download" : "ebook.preview")}{locale !== "ko" ? ` · ${t("ebook.languageBadge")}` : ""}
              </span>
              <span className="ebook-card-cover">
                <Image
                  src={pageImage(book.slug, 1)}
                  alt={t("ebook.cover", { title: bookTitle(book) })}
                  fill
                  sizes="(max-width: 520px) 168px, 206px"
                  quality={88}
                  className="ebook-card-image"
                />
              </span>
            </button>
          ))}
        </div>

        {activeBook && (
          <div
            className="ebook-preview-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closePreview();
            }}
          >
            <div
              className="ebook-preview-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ebook-dialog-title"
              aria-describedby="ebook-dialog-description"
            >
              <header className="ebook-preview-header">
                <div>
                  <h2 id="ebook-dialog-title">{bookTitle(activeBook)}</h2>
                  <p id="ebook-dialog-description">{t("ebook.previewPages", { count: activeBook.pageCount })}</p>
                </div>
                <button ref={closeButtonRef} type="button" onClick={closePreview} aria-label={t("ebook.closePreview")}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </header>

              <div className="ebook-preview-scroll">
                <ol className="ebook-preview-pages">
                  {previewPages.map((page) => (
                    <li key={page}>
                      <div className="ebook-preview-page-meta"><strong>{t("ebook.previewPage", { page })}</strong></div>
                      <div className="ebook-preview-page-image">
                        <Image
                          src={pageImage(activeBook.slug, page)}
                          alt={t("ebook.page", { title: bookTitle(activeBook), page })}
                          width={2000}
                          height={activeBook.pageHeight}
                          sizes="(max-width: 760px) calc(100vw - 32px), 720px"
                          quality={92}
                        />
                      </div>
                    </li>
                  ))}
                </ol>

                <div
                  className="ebook-preview-locked"
                  aria-label={t("ebook.locked")}
                >
                  <Image
                    src={pageImage(activeBook.slug, 4)}
                    alt=""
                    width={2000}
                    height={activeBook.pageHeight}
                    sizes="(max-width: 760px) calc(100vw - 32px), 720px"
                  />
                  <div className="ebook-preview-lock-copy">
                    <span aria-hidden="true">
                      <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                    </span>
                    <strong>{t("ebook.locked")}</strong>
                    <p>{t("ebook.unlock")}</p>
                    {!canDownload && (
                      <button
                        ref={yearlyCtaRef}
                        type="button"
                        className="ebook-preview-lock-cta"
                        onClick={choosePackage}
                      >
                        {t("ebook.choosePlan")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <PaymentMessageOverlay
        open={downloadMessage !== null}
        tone={downloadMessage?.tone || "info"}
        title={downloadMessage?.title || ""}
        message={downloadMessage?.message || ""}
        closeLabel={t("common.confirm")}
        onClose={() => setDownloadMessage(null)}
        highlight={downloadMessage?.remaining !== null && downloadMessage?.remaining !== undefined ? (
          <div className="relative mt-5 rounded-2xl border border-white/10 bg-black/20 px-5 py-4">
            <span className="block text-xs font-bold text-neutral-400">{t("ebook.remainingLabel")}</span>
            <strong className="mt-1 block text-3xl font-black text-white">
              {t("ebook.remainingCount", { count: downloadMessage.remaining })}
            </strong>
          </div>
        ) : undefined}
      />
    </>
  );
}
