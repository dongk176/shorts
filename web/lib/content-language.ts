import catalog from "./content-languages.json";
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

// Keep title selection consistent with the initial worker's CJK font policy.
export function contentTitleFont<T extends string>(text: string, fontId: T, japaneseEnabled = false): T | "noto-sans-kr" | "noto-sans-jp" {
  if (japaneseEnabled) return "noto-sans-jp";
  if (/[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/u.test(text)) {
    return fontId === "noto-sans-kr" || fontId === "noto-serif-kr" ? fontId : "noto-sans-kr";
  }
  return fontId;
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
