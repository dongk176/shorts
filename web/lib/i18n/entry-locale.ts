import { isSiteLocale, type SiteLocale } from "./config";

// This chooses a home-page destination, never a billing country or currency.
export function entryLocale(saved: string | undefined, country: string | null, languages: string | null): SiteLocale {
  if (isSiteLocale(saved)) return saved;
  const code = country?.trim().toUpperCase();
  if (code === "KR") return "ko";
  if (code === "JP") return "ja";
  if (code && /^[A-Z]{2}$/.test(code) && !["XX", "ZZ"].includes(code)) return "en";

  // Local development and requests without geo data use the browser's supported
  // language preferences. Other languages fall back to English; no signal keeps Korean.
  const preferences = (languages || "").split(",").map((part) => {
    const [tag, ...parameters] = part.trim().toLowerCase().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const weight = quality ? Number(quality.trim().slice(2)) : 1;
    return { locale: tag.split("-")[0], weight };
  }).filter(({ locale, weight }) => locale && Number.isFinite(weight) && weight > 0 && weight <= 1)
    .sort((a, b) => b.weight - a.weight);
  const preferred = preferences.find(({ locale }) => isSiteLocale(locale))?.locale;
  return isSiteLocale(preferred) ? preferred : (preferences.length ? "en" : "ko");
}

export function isLocaleCrawler(userAgent: string | null) {
  return /bot|crawler|spider|slurp|facebookexternalhit|whatsapp|telegram|preview/i.test(userAgent || "");
}
