import catalog from "./content-languages.json";
import cjkFontCoverage from "./editor-cjk-font-coverage.json";
import { outputLanguages, type OutputLanguage } from "./contracts";

export const contentLanguages = catalog;

export function normalizeOutputLanguage(value: unknown): OutputLanguage {
  return outputLanguages.includes(value as OutputLanguage) ? value as OutputLanguage : "ko";
}

export function commentDuplicateKey(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// Reject obvious foreign scripts without a second AI/translation request.
export function textMatchesLanguage(value: string, language: OutputLanguage) {
  const text = value.normalize("NFKC");
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  const hangul = /[가-힣ㄱ-ㅎㅏ-ㅣ\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]/u.test(text);
  const kana = /[\u3040-\u30ff]/u.test(text);
  const han = /[\u3400-\u9fff]/u.test(text);
  if (language === "ko") return hangul && !kana;
  if (language === "ja") return (kana || han) && !hangul;
  if (language === "zh-CN") return han && !hangul && !kana;
  return letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

export function commentAgeLabel(months: number, language: OutputLanguage = "ko") {
  return catalog[language].age[months === 1 ? 0 : 1].replace("{count}", String(months));
}

// Initial generation chooses a default face. Later edits must retain the user's
// compatible choice instead of resetting every Japanese title to that default.
export function contentTitleFont<T extends string>(text: string, fontId: T, japaneseEnabled = false, preserveLegacyJapaneseComments = false): T | "noto-sans-kr" | "noto-sans-jp" {
  // Older comment-card workers use the title face as their Japanese-comment
  // switch. Keep that contract until those projects have a compatible worker.
  if (japaneseEnabled && preserveLegacyJapaneseComments) return "noto-sans-jp";
  return contentTextFont(text, fontId, japaneseEnabled);
}

export function commentFontFamily(text: string, japaneseEnabled: boolean) {
  return japaneseEnabled && /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/u.test(text)
    ? '"Editor Noto Sans JP", sans-serif' : undefined;
}

export function commentActionLabels(likeCount: number, language: OutputLanguage = "ko") {
  let likes: string;
  if (language === "ko" && likeCount >= 10_000) likes = `${Math.floor(likeCount / 1_000) / 10}만`;
  else if (language === "ko" && likeCount >= 1_000) likes = `${Math.floor(likeCount / 100) / 10}천`;
  else if ((language === "ja" || language === "zh-CN") && likeCount >= 10_000) likes = `${Math.floor(likeCount / 1_000) / 10}万`;
  else if (!["ko", "ja", "zh-CN"].includes(language) && likeCount >= 1_000) likes = `${Math.floor(likeCount / 100) / 10}K`;
  else likes = String(likeCount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return { likes, reply: catalog[language].reply };
}

const cjkFontBitmaps = Object.fromEntries(Object.entries(cjkFontCoverage).map(([id, data]) => [id, atob(data.bmp)]));
const cjkCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\uff66-\uff9f]/u;

/** Browser fallback can display glyphs absent from the worker font. Check the
 * exact bundled cmap, including Japanese variants missing from Korean Noto. */
export function supportsCjkText(text: string, fontId: string, japaneseEnabled = false) {
  const characters = Array.from(text).filter((character) => cjkCharacter.test(character));
  if (characters.length === 0) return true;
  if (!(fontId in cjkFontCoverage) || (fontId === "noto-sans-jp" && !japaneseEnabled)) return false;
  const ranges = cjkFontCoverage[fontId as keyof typeof cjkFontCoverage].ranges;
  return characters.every((character) => {
    const point = character.codePointAt(0)!;
    if (point < 65536) return (cjkFontBitmaps[fontId].charCodeAt(point >>> 3) & (1 << (point & 7))) !== 0;
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const [start, end] = ranges[middle];
      if (point < start) high = middle - 1;
      else if (point > end) low = middle + 1;
      else return true;
    }
    return false;
  });
}

export function contentTextFont<T extends string>(text: string, fontId: T, japaneseEnabled = false): T | "noto-sans-kr" | "noto-sans-jp" {
  if (supportsCjkText(text, fontId, japaneseEnabled)) return fontId;
  return japaneseEnabled ? "noto-sans-jp" : "noto-sans-kr";
}

export function hasUnsupportedCjkFont(document: {
  title: { text: string };
  channel: { displayName: string };
  overlays: { fonts: { title: string; channel: string }; visible: { title: boolean; channel: boolean };
    textOverlays: Array<{ text: string; fontId: string }> };
}) {
  return (document.overlays.visible.title
    && !supportsCjkText(document.title.text, document.overlays.fonts.title, true))
    || (document.overlays.visible.channel
    && !supportsCjkText(document.channel.displayName, document.overlays.fonts.channel, true))
    || document.overlays.textOverlays.some((overlay) => !supportsCjkText(overlay.text, overlay.fontId, true));
}
