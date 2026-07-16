type YoutubeLanguageMetadata = {
  title: string;
  description?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
};

const KOREAN_LANGUAGE_CODE = /^ko(?:[-_]|$)/i;
const HANGUL_CHARACTER = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g;

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
