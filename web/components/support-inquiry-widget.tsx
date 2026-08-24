"use client";

import Link from "next/link";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { MvpState } from "@/lib/contracts";
import { localizeApiError } from "@/lib/i18n/errors";
import { useI18n } from "@/lib/i18n/provider";
import type { SupportInquiryCategory } from "@/lib/support-inquiry";

type InquiryResponse = {
  submitted: true;
  inquiryId: string;
  referenceCode: string;
  createdAt: string;
};

type WidgetView = "menu" | "form";

const categoryOptions: Array<{
  category: SupportInquiryCategory;
  labelKey:
    | "supportWidget.usage"
    | "supportWidget.billingRefund"
    | "supportWidget.technical"
    | "supportWidget.other";
  descriptionKey:
    | "supportWidget.usageDescription"
    | "supportWidget.billingRefundDescription"
    | "supportWidget.technicalDescription"
    | "supportWidget.otherDescription";
  icon: ReactNode;
}> = [
  {
    category: "service_usage",
    labelKey: "supportWidget.usage",
    descriptionKey: "supportWidget.usageDescription",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8.5 7.5h7M8.5 11.5h7M8.5 15.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6.5 3.75h11A2.25 2.25 0 0 1 19.75 6v12A2.25 2.25 0 0 1 17.5 20.25h-11A2.25 2.25 0 0 1 4.25 18V6A2.25 2.25 0 0 1 6.5 3.75Z" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    category: "billing_refund",
    labelKey: "supportWidget.billingRefund",
    descriptionKey: "supportWidget.billingRefundDescription",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 8.25h16M7 15.75h3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="3.75" y="5" width="16.5" height="14" rx="2.25" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    category: "technical_issue",
    labelKey: "supportWidget.technical",
    descriptionKey: "supportWidget.technicalDescription",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 4.5h6M12 4.5V2.75M7.25 9h9.5v7.25A3.75 3.75 0 0 1 13 20h-2a3.75 3.75 0 0 1-3.75-3.75V9Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.5 11.5h2.75M16.75 11.5h2.75M5 17.5l2.5-1M19 17.5l-2.5-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    category: "other",
    labelKey: "supportWidget.other",
    descriptionKey: "supportWidget.otherDescription",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5.25 5.25h13.5v10.5H9L5.25 19.5V5.25Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8.5 9.25h7M8.5 12.25h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
];

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m7.75 5.75 4.25 4.25-4.25 4.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SupportInquiryWidget({
  user,
}: {
  user: MvpState["user"];
  onLoginRequest?: () => void;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<WidgetView>("menu");
  const [category, setCategory] = useState<SupportInquiryCategory | null>(null);
  const [contactEmail, setContactEmail] = useState(user?.loginId ? "" : user?.email || "");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InquiryResponse | null>(null);
  const [referenceCopied, setReferenceCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const successOverlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.email && !user.loginId) {
      setContactEmail((current) => current || user.email || "");
    }
  }, [user?.email, user?.loginId]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [open]);

  useEffect(() => {
    if (open && contentRef.current) contentRef.current.scrollTop = 0;
  }, [open, view]);

  useEffect(() => {
    if (!open && !result) return;
    document.body.classList.add("support-inquiry-open");
    return () => document.body.classList.remove("support-inquiry-open");
  }, [open, result]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const chooseCategory = (nextCategory: SupportInquiryCategory) => {
    setCategory(nextCategory);
    setMessage("");
    setView("form");
    setError(null);
    setResult(null);
    requestIdRef.current = null;
  };

  const startNewInquiry = () => {
    setView("menu");
    setCategory(null);
    setMessage("");
    setResult(null);
    setReferenceCopied(false);
    setError(null);
    requestIdRef.current = null;
  };

  const dismissSuccess = () => {
    startNewInquiry();
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const startAnotherInquiry = () => {
    startNewInquiry();
    setOpen(true);
  };

  useEffect(() => {
    if (!result) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => successOverlayRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setResult(null);
      setView("menu");
      setCategory(null);
      setMessage("");
      setReferenceCopied(false);
      setError(null);
      requestIdRef.current = null;
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [result]);

  const backFromForm = () => {
    setError(null);
    requestIdRef.current = null;
    setView("menu");
  };

  const submitInquiry = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !category) return;
    setSubmitting(true);
    setError(null);
    const requestId = requestIdRef.current || crypto.randomUUID();
    requestIdRef.current = requestId;

    try {
      const response = await fetch("/api/support/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId,
          category,
          contactEmail,
          message,
          locale,
          pagePath: window.location.pathname,
          inquiryKind: "general",
          billingOrderId: null,
          refundReasonCode: null,
        }),
      });
      const body = await response.json().catch(() => ({})) as InquiryResponse & {
        detail?: string;
        code?: string;
      };
      if (!response.ok) {
        throw new Error(localizeApiError(body, response.status, locale));
      }
      setResult(body);
      setReferenceCopied(false);
      setOpen(false);
      setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("supportWidget.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedOption = categoryOptions.find((option) => option.category === category);
  const successTitleKey = category === "service_usage"
      ? "supportWidget.successUsageTitle"
      : category === "billing_refund"
        ? "supportWidget.successBillingTitle"
        : category === "technical_issue"
          ? "supportWidget.successTechnicalTitle"
          : "supportWidget.successOtherTitle";
  const successDescriptionKey = category === "service_usage"
      ? "supportWidget.successUsageDescription"
      : category === "billing_refund"
        ? "supportWidget.successBillingDescription"
        : category === "technical_issue"
          ? "supportWidget.successTechnicalDescription"
          : "supportWidget.successOtherDescription";

  const copyReference = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.referenceCode);
      setReferenceCopied(true);
    } catch {
      // The reference remains selectable if clipboard access is unavailable.
    }
  };

  return (
    <div className="support-inquiry-widget">
      <style>{".support-inquiry-open .language-selector-floating { display: none; }"}</style>
      {open && (
        <section
          ref={panelRef}
          id="support-inquiry-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="support-inquiry-title"
          tabIndex={-1}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-white/[.12] bg-[#191c1e]/[.98] text-left shadow-[0_28px_90px_rgba(0,0,0,.62),0_0_42px_rgba(255,113,94,.08)] outline-none backdrop-blur-2xl sm:inset-x-auto sm:bottom-[calc(82px+env(safe-area-inset-bottom,0px))] sm:right-[calc(24px+env(safe-area-inset-right,0px))] sm:z-40 sm:max-h-[min(640px,calc(100dvh-var(--site-header-height)-98px))] sm:w-[calc(100vw-32px)] sm:max-w-[370px] sm:rounded-[22px] sm:border-b"
        >
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-2 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20 sm:hidden"
          />
          <header className="relative shrink-0 overflow-hidden border-b border-white/[.08] px-5 pb-5 pt-5">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(255,113,94,.2),transparent_48%),radial-gradient(circle_at_95%_0%,rgba(160,120,255,.16),transparent_46%)]" />
            <div className="relative flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-[#ff715e] to-[#8b5cf6] text-white shadow-[0_8px_24px_rgba(240,68,53,.24)]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                    <path d="M5 5.25h14v10.5H9l-4 3.5v-14Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                    <path d="M8.5 9.25h7M8.5 12.25h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h2 id="support-inquiry-title" className="text-lg font-black tracking-[-.035em] text-white">
                    {t("supportWidget.trigger")}
                  </h2>
                  <p className="mt-0.5 text-[11px] font-medium leading-4 text-neutral-400">
                    {t("supportWidget.responseNote")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeAndRestoreFocus}
                aria-label={t("supportWidget.close")}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 bg-black/15 text-neutral-400 transition hover:border-white/20 hover:bg-white/[.07] hover:text-white"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                  <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </header>

          <div
            ref={contentRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)] sm:pb-0"
          >
            {view === "menu" && (
              <div className="p-3">
                <p className="px-2 pb-3 pt-1 text-sm leading-6 text-neutral-400">
                  {t("supportWidget.intro")}
                </p>
                <Link
                  href="/faq"
                  onClick={() => setOpen(false)}
                  className="group mb-2 flex min-h-[62px] items-center gap-3 rounded-2xl border border-[#a078ff]/20 bg-[#a078ff]/[.07] px-3.5 py-3 transition hover:border-[#a078ff]/40 hover:bg-[#a078ff]/[.12]"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#a078ff]/15 text-[#c9b5ff]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M9.75 9.25a2.35 2.35 0 1 1 3.2 2.2c-.7.3-.95.75-.95 1.55M12 16.25h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-extrabold text-white">{t("supportWidget.faq")}</strong>
                    <span className="mt-0.5 block text-xs leading-5 text-neutral-400">{t("supportWidget.faqDescription")}</span>
                  </span>
                  <span className="h-5 w-5 shrink-0 text-neutral-500 transition group-hover:translate-x-0.5 group-hover:text-white"><ChevronIcon /></span>
                </Link>

                <div className="grid gap-1">
                  {categoryOptions.map((option) => (
                    <button
                      key={option.category}
                      type="button"
                      onClick={() => chooseCategory(option.category)}
                      className="group flex min-h-[62px] w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition hover:bg-white/[.055]"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[.08] bg-white/[.04] text-[#ff9b8d] [&>svg]:h-5 [&>svg]:w-5">
                        {option.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block text-sm font-extrabold text-neutral-100">{t(option.labelKey)}</strong>
                        <span className="mt-0.5 block text-xs leading-5 text-neutral-500">{t(option.descriptionKey)}</span>
                      </span>
                      <span className="h-5 w-5 shrink-0 text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-neutral-300"><ChevronIcon /></span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {view === "form" && selectedOption && (
              <form onSubmit={submitInquiry} className="p-5">
                <button
                  type="button"
                  onClick={backFromForm}
                  className="mb-5 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 text-xs font-bold text-neutral-400 transition hover:text-white"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                    <path d="m12.25 5.75-4.25 4.25 4.25 4.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t("supportWidget.back")}
                </button>

                <label className="block">
                  <span className="text-xs font-extrabold text-neutral-200">{t("supportWidget.email")}</span>
                  <input
                    type="email"
                    required
                    maxLength={320}
                    autoComplete="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder={t("supportWidget.emailPlaceholder")}
                    className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 text-sm text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8c7c]/60 focus:ring-4 focus:ring-[#ff715e]/10"
                  />
                </label>

                <label className="mt-5 block">
                  <span className="text-xs font-extrabold text-neutral-200">{t("supportWidget.message")}</span>
                  <textarea
                    required
                    minLength={10}
                    maxLength={2000}
                    rows={3}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={t("supportWidget.messagePlaceholder")}
                    className="mt-2 h-[84px] min-h-[84px] w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-neutral-600 focus:border-[#ff8c7c]/60 focus:ring-4 focus:ring-[#ff715e]/10"
                  />
                  <span className="mt-1.5 block text-right text-[10px] font-medium text-neutral-600">{message.length}/2000</span>
                </label>

                {error && (
                  <p role="alert" className="mt-4 rounded-xl border border-red-400/20 bg-red-500/[.08] px-3.5 py-3 text-xs leading-5 text-red-200">
                    {error}
                  </p>
                )}

                <p className="mt-4 text-[11px] leading-5 text-neutral-500">
                  {t("supportWidget.privacyPrefix")}
                  <Link href="/privacy" className="block w-fit font-bold text-neutral-300 underline underline-offset-2">
                    {t("supportWidget.privacyLink")}
                  </Link>
                </p>

                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#f04435] to-[#8b5cf6] px-5 text-sm font-black text-white shadow-[0_12px_30px_rgba(240,68,53,.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {submitting && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                  {submitting ? t("supportWidget.submitting") : t("supportWidget.submit")}
                </button>
              </form>
            )}

          </div>
        </section>
      )}

      {result && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissSuccess();
          }}
        >
          <div
            ref={successOverlayRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-success-title"
            tabIndex={-1}
            className="relative max-h-[90dvh] w-full max-w-[420px] overflow-y-auto overscroll-contain rounded-[24px] border border-white/[.12] bg-[#191c1e] px-5 pb-[calc(24px+env(safe-area-inset-bottom,0px))] pt-8 text-center shadow-[0_32px_120px_rgba(0,0,0,.72),0_0_50px_rgba(52,211,153,.08)] outline-none sm:px-6 sm:pb-7"
          >
            <button
              type="button"
              onClick={dismissSuccess}
              aria-label={t("supportWidget.close")}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-black/15 text-neutral-400 transition hover:border-white/20 hover:bg-white/[.07] hover:text-white"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>

            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-emerald-300/25 bg-emerald-400/10 text-emerald-300 shadow-[0_0_32px_rgba(52,211,153,.12)]">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden="true">
                <path d="m6.5 12.25 3.5 3.5 7.75-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 id="support-success-title" className="mt-5 text-xl font-black leading-7 tracking-[-.035em] text-white">
              {t(successTitleKey)}
            </h3>
            <p className="mx-auto mt-3 max-w-[330px] text-sm leading-6 text-neutral-400">
              {t(successDescriptionKey)}
            </p>

            <div className="mt-4 rounded-2xl border border-white/[.08] bg-white/[.025] p-4 text-left">
              <p className="text-[10px] font-black uppercase tracking-[.12em] text-neutral-500">
                {t("supportWidget.successEmailLabel")}
              </p>
              <p className="mt-1.5 break-all text-sm font-extrabold text-neutral-100">
                {contactEmail}
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-white/[.08] bg-black/15 px-3 py-4">
              <div className="flex items-start">
                {[
                  "supportWidget.successStepReceived",
                  "supportWidget.successStepReview",
                  "supportWidget.successStepReply",
                ].map((step, index) => (
                  <div key={step} className="relative flex min-w-0 flex-1 flex-col items-center">
                    {index > 0 && (
                      <span className="absolute right-1/2 top-3 h-px w-full bg-white/10" aria-hidden="true" />
                    )}
                    <span className={`relative z-10 grid h-6 w-6 place-items-center rounded-full border text-[10px] font-black ${
                      index === 0
                        ? "border-emerald-300/35 bg-emerald-400/15 text-emerald-300"
                        : "border-white/10 bg-[#191c1e] text-neutral-600"
                    }`}>
                      {index === 0 ? "✓" : index + 1}
                    </span>
                    <span className={`mt-2 text-[10px] font-bold ${
                      index === 0 ? "text-emerald-300" : "text-neutral-500"
                    }`}>
                      {t(step as
                        | "supportWidget.successStepReceived"
                        | "supportWidget.successStepReview"
                        | "supportWidget.successStepReply")}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/[.08] bg-white/[.025] px-3.5 py-2.5 text-left">
              <span className="min-w-0">
                <span className="block text-[10px] font-bold text-neutral-600">
                  {t("supportWidget.referenceLabel")}
                </span>
                <span className="block truncate font-mono text-xs font-bold text-neutral-300">
                  {result.referenceCode}
                </span>
              </span>
              <button
                type="button"
                onClick={copyReference}
                className="min-h-9 shrink-0 rounded-lg border border-white/10 px-3 text-[11px] font-extrabold text-neutral-300 transition hover:border-white/25 hover:bg-white/[.05] hover:text-white"
              >
                {referenceCopied
                  ? t("supportWidget.referenceCopied")
                  : t("supportWidget.referenceCopy")}
              </button>
            </div>

            <div className="mt-5 grid gap-2.5">
              {category === "service_usage" ? (
                <Link
                  href="/faq"
                  onClick={startNewInquiry}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-white px-5 text-sm font-black text-black transition hover:bg-neutral-200"
                >
                  {t("supportWidget.successFaqButton")}
                </Link>
              ) : category === "billing_refund" ? (
                <Link
                  href="/account/activity"
                  onClick={startNewInquiry}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-white px-5 text-sm font-black text-black transition hover:bg-neutral-200"
                >
                  {t("supportWidget.successPaymentsButton")}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={dismissSuccess}
                  className="min-h-12 w-full rounded-xl bg-white px-5 text-sm font-black text-black transition hover:bg-neutral-200"
                >
                  {t("supportWidget.successCloseButton")}
                </button>
              )}
              <button
                type="button"
                onClick={startAnotherInquiry}
                className="min-h-11 w-full rounded-xl border border-white/12 px-5 text-sm font-extrabold text-white transition hover:border-white/25 hover:bg-white/[.055]"
              >
                {t("supportWidget.newInquiry")}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        aria-label={t("supportWidget.trigger")}
        aria-expanded={open}
        aria-controls="support-inquiry-panel"
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className="fixed bottom-[calc(16px+env(safe-area-inset-bottom,0px))] right-[calc(16px+env(safe-area-inset-right,0px))] z-40 inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-gradient-to-br from-[#f04435] via-[#f05b4c] to-[#8b5cf6] text-white shadow-[0_16px_42px_rgba(0,0,0,.46),0_8px_26px_rgba(240,68,53,.3)] transition hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#ff9b8d] active:translate-y-0 sm:right-[calc(24px+env(safe-area-inset-right,0px))]"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7 shrink-0" fill="none" aria-hidden="true">
          <path d="M5 5.25h14v10.5H9l-4 3.5v-14Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
          <path d="M8.5 9.25h7M8.5 12.25h4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
