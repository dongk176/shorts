import { translateLegacyText } from "./legacy-phrases";
import type { SiteLocale } from "./config";

// Product UI only. Authored video content must not call this formatter.
export function createUiText(locale: SiteLocale) {
  function ui<T>(value: T): T extends string ? string : T;
  function ui(value: unknown): unknown {
    if (typeof value !== "string") return value;
    const translated = translateLegacyText(value, locale);
    if (translated !== value) return translated;
    return value.split(/(\n|\\n)/).map(part => translateLegacyText(part, locale)).join("");
  }
  return ui;
}
