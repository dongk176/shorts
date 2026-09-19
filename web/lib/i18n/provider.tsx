"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { localePath, isLocalizedPage } from "./routing";
import { messagesByLocale } from "./messages";
import type { SiteLocale } from "./config";
import {
  interpolateMessage,
  type MessageKey,
  type Messages,
} from "./messages";
import { LegacyTranslationBridge } from "@/components/legacy-translation-bridge";

type I18nContextValue = {
  locale: SiteLocale;
  messages: Messages;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale: initialLocale,
  children,
}: {
  locale: SiteLocale;
  messages: Messages;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const route = pathname ? localePath(pathname) : null;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  // Rewrites can expose the internal pathname during SSR. Start with the
  // request locale on both renders, then follow navigation in this tab.
  const locale = hydrated && route && isLocalizedPage(route.pathname) ? route.locale : initialLocale;
  const messages = messagesByLocale[locale];
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => (
    interpolateMessage(messages[key], values)
  ), [messages]);
  const value = useMemo(() => ({ locale, messages, t }), [locale, messages, t]);

  return (
    <I18nContext.Provider value={value}>
      <LegacyTranslationBridge locale={locale} />
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}

export function useNavigationLocale() {
  return useContext(I18nContext)?.locale ?? "ko";
}
