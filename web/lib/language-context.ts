import catalog from "./language-context.json";
import type { OutputLanguage } from "./contracts";

export const sourceLanguages = ["auto", "ko", "en", "ja"] as const;
export type SourceLanguage = (typeof sourceLanguages)[number];

export function normalizeSourceLanguage(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const code = (catalog.aliases as Record<string, string>)[raw] || raw;
  return /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(code) && code !== "auto" ? code : "und";
}

export function resolveSourceLanguage(hint: unknown, detected?: unknown): string | undefined {
  if (hint == null) return undefined;
  if (!sourceLanguages.includes(hint as SourceLanguage)) throw new Error("Unsupported source language hint");
  return normalizeSourceLanguage(hint === "auto" ? detected : hint);
}

export function languageContext(sourceLanguage: string | undefined, outputLanguage: OutputLanguage, instruction?: string) {
  if (sourceLanguage === undefined) return "";
  const source = normalizeSourceLanguage(sourceLanguage);
  const locale = outputLanguage === "ko" || outputLanguage === "ja" ? outputLanguage : "en";
  const names: Record<string, string> = catalog.names[locale];
  const values: Record<string, string> = {
    source: names[source] || source, source_code: source,
    target: names[outputLanguage] || outputLanguage, target_code: outputLanguage,
  };
  return (instruction || catalog.instructions[locale]).replace(/\{([a-z_]+)\}/g, (_, key: string) => values[key]);
}

export function mentionedCurrencies(text: string) {
  return new Set(Object.entries(catalog.currencyPatterns)
    .filter(([, pattern]) => new RegExp(pattern, "iu").test(text))
    .map(([currency]) => currency));
}

export function hasUnlabeledAmount(text: string, source: string) {
  const sourceHasCurrency = mentionedCurrencies(source).size > 0;
  if (!sourceHasCurrency && !new RegExp(catalog.monetaryContextPattern, "iu").test(source + "\n" + text)) return false;
  const normalized = text.normalize("NFKC");
  const pattern = `(${catalog.scaledNumberPattern})|(${catalog.vagueScaledNumberPattern})|(${catalog.bareLargeNumberPattern})`;
  for (const amount of normalized.matchAll(new RegExp(pattern, "giu"))) {
    const before = normalized.slice(0, amount.index).trimEnd();
    let after = normalized.slice(amount.index + amount[0].length).trimStart();
    if (amount[2] !== undefined) after = after.replace(/^of\s+/iu, "");
    if (new RegExp(catalog.amountCurrencyLabelPattern + "$", "iu").test(before)
      || new RegExp("^(?:" + catalog.amountCurrencyLabelPattern + ")", "iu").test(after)) continue;
    // A range can share its final scale and currency label.
    const rangeEnd = `(?:${catalog.scaledNumberPattern}|${catalog.bareLargeNumberPattern})`;
    if (new RegExp("^(?:" + catalog.amountRangeSeparatorPattern + rangeEnd
      + "\\s*" + catalog.amountCurrencyLabelPattern + ")", "iu").test(after)) continue;
    if (new RegExp("^(?:" + catalog.amountCountUnitPattern + ")", "iu").test(after)) continue;
    if (amount[3] !== undefined) {
      // Source money context alone must not turn every bare year or model into money.
      if (!new RegExp(catalog.monetaryContextPattern, "iu").test(normalized)) continue;
      if (new RegExp(catalog.nonAmountNumberPrefixPattern, "iu").test(before)) continue;
    }
    return true;
  }
  return false;
}
