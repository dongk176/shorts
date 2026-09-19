import { translateLegacyText } from "./legacy-phrases";
import type { SiteLocale } from "./config";

// Reuse the existing copy dictionary during render, on the server and client.
// Non-text children retain their identity; authored content must not call this.
export function createUiText(locale: SiteLocale) {
  function ui<T>(value: T): T extends string ? string : T;
  function ui(value: unknown): unknown {
    return typeof value === "string" ? translateLegacyText(value, locale) : value;
  }
  return ui;
}
