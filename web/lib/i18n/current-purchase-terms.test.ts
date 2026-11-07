import { describe, expect, it } from "vitest";
import { currentPurchaseTermsTranslations } from "./current-purchase-terms";
import { purchaseTermsV8Translations } from "./legal-translations";

describe("current Paddle purchase conditions", () => {
  it.each(["en", "ja"] as const)("separates providers while preserving archived %s conditions", (locale) => {
    const current = currentPurchaseTermsTranslations[locale];
    const archived = purchaseTermsV8Translations[locale];
    expect(current.sections[2].paragraphs[0]).toContain("Paddle");
    expect(current.sections[2].paragraphs[0]).toMatch(/3.*6.*12/);
    for (const index of [2, 4, 5]) {
      expect(current.sections[index].paragraphs.slice(1).every(p => p.startsWith("ThePayOne"))).toBe(true);
      archived.sections[index].paragraphs.forEach((p, n) => expect(current.sections[index].paragraphs[n + 1]).toContain(p));
      expect(archived.sections[index].paragraphs.some(p => p.includes("Paddle"))).toBe(false);
    }
    expect(current.sections[10]).toEqual(archived.sections[10]);
  });
});
