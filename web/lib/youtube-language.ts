type YoutubeLanguageMetadata = {
  title: string;
  description?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
};

const KOREAN_LANGUAGE_CODE = /^ko(?:[-_]|$)/i;
const HANGUL_CHARACTER = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g;
// Shared with the catalog SQL guard so old stored classifications are checked too.
export const KOREAN_TITLE_PATTERN = "[ᄀ-ᇿ㄰-㆏가-힣].*[ᄀ-ᇿ㄰-㆏가-힣]";
export const JAPANESE_TITLE_PATTERN = "[ぁ-ゖァ-ヺ].*[ぁ-ゖァ-ヺ]";

export function hasConflictingLanguageTitle(title: string, language: "ja" | "en") {
  const normalized = title.normalize("NFKC");
  return new RegExp(KOREAN_TITLE_PATTERN, "s").test(normalized)
    || (language === "en" && new RegExp(JAPANESE_TITLE_PATTERN, "s").test(normalized));
}

function isKoreanLanguageCode(value: string | undefined) {
  return Boolean(value?.trim().match(KOREAN_LANGUAGE_CODE));
}

function hasKoreanText(value: string, minimumCharacters: number) {
  return (value.match(HANGUL_CHARACTER)?.length || 0) >= minimumCharacters;
}

export function isKoreanVideo(metadata: YoutubeLanguageMetadata) {
  if (
    isKoreanLanguageCode(metadata.defaultAudioLanguage)
    || isKoreanLanguageCode(metadata.defaultLanguage)
  ) {
    return true;
  }

  return hasKoreanText(metadata.title, 2)
    || hasKoreanText(metadata.description || "", 10);
}

/** Prefer explicit audio language; title is only a fallback without language metadata. */
export function isJapaneseVideo(metadata: YoutubeLanguageMetadata) {
  if (isKoreanLanguageCode(metadata.defaultLanguage)
    || hasConflictingLanguageTitle(metadata.title, "ja")) return false;
  const language = metadata.defaultAudioLanguage?.trim() || metadata.defaultLanguage?.trim();
  if (language) return /^ja(?:[-_]|$)/i.test(language);
  return (metadata.title.normalize("NFKC").match(/[\u3041-\u3096\u30a1-\u30fa]/g)?.length || 0) >= 2;
}

/** Keep the metadata fallback, but reject contradictory Korean signals.
 * Some Korean uploads set English audio tags incorrectly. Descriptions are often
 * localized, so Korean description text alone must not exclude English videos. */
export function isEnglishVideo(metadata: YoutubeLanguageMetadata) {
  const language = metadata.defaultAudioLanguage?.trim() || metadata.defaultLanguage?.trim();
  return Boolean(language && /^en(?:[-_]|$)/i.test(language)
    && !isKoreanLanguageCode(metadata.defaultLanguage)
    && !/^ja(?:[-_]|$)/i.test(metadata.defaultLanguage?.trim() || "")
    && !hasConflictingLanguageTitle(metadata.title, "en"));
}
