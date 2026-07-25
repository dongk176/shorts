"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { SHOW_MONETIZATION_CONTENT } from "@/lib/content-visibility";

type Ebook = {
  slug: string;
  title: string;
  pageCount: number;
  pageHeight: number;
  monetizationRelated?: boolean;
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

export function EbookPreviewRail({
  canDownload,
  onChoosePackage,
}: {
  canDownload: boolean;
  onChoosePackage: () => void;
}) {
  const [activeBook, setActiveBook] = useState<Ebook | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const yearlyCtaRef = useRef<HTMLButtonElement>(null);
  const activeTriggerRef = useRef<HTMLButtonElement>(null);

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

  return (
    <section className="pricing-ebooks" aria-labelledby="ebook-preview-heading">
      <div className="ebook-rail-heading">
        <div>
          <h2 id="ebook-preview-heading">숏폼 전략 가이드 전자책</h2>
          <p>활성 기간 패키지 이용자는 모든 전자책 원본을 다운로드할 수 있습니다. 각 전자책은 3페이지까지 미리 볼 수 있습니다.</p>
        </div>
        <div className="ebook-rail-actions" aria-label="전자책 목록 이동">
          <button type="button" onClick={() => scrollRail(-1)} aria-label="이전 전자책 보기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button type="button" onClick={() => scrollRail(1)} aria-label="다음 전자책 보기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      </div>

      <div ref={railRef} className="ebook-rail" aria-label="전자책 미리보기 목록">
        {visibleEbooks.map((book) => (
          <button
            key={book.slug}
            type="button"
            className="ebook-card"
            aria-label={canDownload ? `${book.title} 다운로드` : `${book.title} 미리보기 열기`}
            onClick={(event) => {
              if (canDownload) {
                window.location.assign(`/api/ebooks/${encodeURIComponent(book.slug)}/download`);
                return;
              }
              activeTriggerRef.current = event.currentTarget;
              setActiveBook(book);
            }}
          >
            <span className="ebook-card-title">{book.title}</span>
            <span className="ebook-card-cover">
              <Image
                src={pageImage(book.slug, 1)}
                alt={`${book.title} 표지`}
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
                <h2 id="ebook-dialog-title">{activeBook.title}</h2>
                <p id="ebook-dialog-description">1~3페이지 미리보기 · 전체 {activeBook.pageCount}페이지</p>
              </div>
              <button ref={closeButtonRef} type="button" onClick={closePreview} aria-label="전자책 미리보기 닫기">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </header>

            <div className="ebook-preview-scroll">
              <ol className="ebook-preview-pages">
                {previewPages.map((page) => (
                  <li key={page}>
                    <div className="ebook-preview-page-meta"><strong>{page}</strong><span>/ 3 미리보기</span></div>
                    <div className="ebook-preview-page-image">
                      <Image
                        src={pageImage(activeBook.slug, page)}
                        alt={`${activeBook.title} ${page}페이지`}
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
                aria-label="4페이지부터 잠김"
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
                  <strong>4페이지부터 잠겨 있어요</strong>
                  <p>기간 패키지 구매 시 원본 PDF를 다운로드할 수 있습니다.</p>
                  {!canDownload && (
                    <button
                      ref={yearlyCtaRef}
                      type="button"
                      className="ebook-preview-lock-cta"
                      onClick={choosePackage}
                    >
                      기간 패키지 확인하기
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
