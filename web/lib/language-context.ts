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
