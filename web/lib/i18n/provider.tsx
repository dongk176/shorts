"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
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
  locale,
  messages,
  children,
}: {
  locale: SiteLocale;
  messages: Messages;
  children: ReactNode;
}) {
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
