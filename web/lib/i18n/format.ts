import { formatLocale, type SiteLocale } from "./config";

export function formatNumber(value: number, locale: SiteLocale, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(formatLocale(locale), options).format(value);
}

export function formatKrw(value: number, locale: SiteLocale) {
  return new Intl.NumberFormat(formatLocale(locale), {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatSeoulDate(
  value: string | number | Date,
  locale: SiteLocale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  return new Intl.DateTimeFormat(formatLocale(locale), {
    ...options,
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
