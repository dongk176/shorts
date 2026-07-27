"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { siteLocales, type SiteLocale } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { userFacingErrorMessage } from "@/lib/public-error";

const languageLabels: Record<SiteLocale, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
};

export function LanguageSelector() {
  const router = useRouter();
  const { locale, t } = useI18n();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [pendingLocale, setPendingLocale] = useState<SiteLocale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedLocale = pendingLocale || locale;

  useEffect(() => {
    if (!open) return;

    const selectedIndex = siteLocales.indexOf(selectedLocale);
    optionRefs.current[selectedIndex]?.focus();

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open, selectedLocale]);

  async function changeLocale(nextLocale: SiteLocale) {
    if (nextLocale === locale || pendingLocale) return;
    setPendingLocale(nextLocale);
    setError(null);
    try {
      const response = await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) throw new Error(t("common.languageError"));
      document.documentElement.lang = nextLocale;
      router.refresh();
    } catch (cause) {
      setPendingLocale(null);
      setError(userFacingErrorMessage(cause, t("common.languageError")));
    }
  }

  function selectLocale(nextLocale: SiteLocale) {
    setOpen(false);
    triggerRef.current?.focus();
    void changeLocale(nextLocale);
  }

  function moveOptionFocus(currentIndex: number, direction: 1 | -1) {
    const nextIndex = (currentIndex + direction + siteLocales.length) % siteLocales.length;
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="language-selector-floating"
      data-i18n-skip
      onBlur={() => {
        window.requestAnimationFrame(() => {
          if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
        });
      }}
    >
      {open && (
        <div id={menuId} className="language-selector-menu" role="listbox" aria-label={t("common.language")}>
          <span className="language-selector-menu-title">{t("common.language")}</span>
          {siteLocales.map((option, index) => (
            <button
              key={option}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={option === selectedLocale}
              className="language-selector-option"
              onClick={() => selectLocale(option)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveOptionFocus(index, 1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveOptionFocus(index, -1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  optionRefs.current[0]?.focus();
                } else if (event.key === "End") {
                  event.preventDefault();
                  optionRefs.current[siteLocales.length - 1]?.focus();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  triggerRef.current?.focus();
                } else if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectLocale(option);
                }
              }}
            >
              <span>{languageLabels[option]}</span>
              <svg className="language-selector-check" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 10 3 3 7-7" />
              </svg>
            </button>
          ))}
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        className="language-selector-trigger"
        disabled={pendingLocale !== null}
        aria-label={pendingLocale ? t("common.languageSaving") : t("common.language")}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-expanded={open}
        aria-busy={pendingLocale !== null}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
        <span className="language-selector-current">{languageLabels[selectedLocale]}</span>
        <svg className="language-selector-chevron" aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 12 4-4 4 4" />
        </svg>
      </button>
      {error && <span role="alert" className="language-selector-error">{error}</span>}
    </div>
  );
}
