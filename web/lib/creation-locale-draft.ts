import type { SiteLocale } from "./i18n/config";

export const BEFORE_LOCALE_REFRESH = "easycut:before-locale-refresh";
// A locale refresh remounts the provider to refresh legacy copy. Keep the active
// form only in this tab's memory for that handoff; never persist it across visits.
let pending: { userId: string; locale: SiteLocale; savedAt: number; value: unknown } | null = null;

export function preserveCreationDraft<T>(userId: string, locale: SiteLocale, value: T, now = Date.now()) {
  pending = { userId, locale, savedAt: now, value };
}
export function readCreationDraft<T>(userId: string | null, locale: SiteLocale, now = Date.now()): T | null {
  if (!pending || pending.userId !== userId || pending.locale !== locale
    || now - pending.savedAt > 60_000 || now < pending.savedAt) return null;
  return pending.value as T;
}
export function clearCreationDraft() { pending = null; }
