"use client";

import { useCallback, useEffect, useState } from "react";
import type { SiteLocale } from "@/lib/i18n/config";

export type PopularLanguage = "all" | "ko" | "ja" | "en";
const isLanguage = (value: unknown): value is PopularLanguage => ["all", "ko", "ja", "en"].includes(value as string);

export function usePopularLanguage(locale: SiteLocale, canUseFilters: boolean, accountKey?: string) {
  const storageKey = `easycut:popular-language:v1:${accountKey || "anonymous"}`;
  const context = `${storageKey}:${locale}:${canUseFilters}`;
  const [preference, setPreference] = useState<{ context: string; value: PopularLanguage } | null>(null);
  const ready = preference?.context === context;
  const language = canUseFilters ? (ready ? preference.value : locale) : "all";

  useEffect(() => {
    let value: PopularLanguage = canUseFilters ? locale : "all";
    if (canUseFilters) {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (isLanguage(saved)) value = saved;
      } catch { /* Use the page language when browser storage is unavailable. */ }
    }
    setPreference({ context, value });
  }, [context, storageKey, locale, canUseFilters]);

  const setLanguage = useCallback((value: PopularLanguage, remember = true) => {
    setPreference({ context, value });
    if (remember && canUseFilters) {
      try { window.localStorage.setItem(storageKey, value); } catch { /* Selection still works without storage. */ }
    }
  }, [context, storageKey, canUseFilters]);
  return { language, ready, setLanguage };
}
