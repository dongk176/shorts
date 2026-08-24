import type { OutputLanguage, VideoAspectRatio } from "@/lib/contracts";
import type { SiteLocale } from "./config";

const outputLanguageNames: Record<SiteLocale, Record<OutputLanguage, string>> = {
  ko: { ko: "한국어", en: "영어", ja: "일본어", "zh-CN": "중국어(간체)", es: "스페인어", fr: "프랑스어", de: "독일어", "pt-BR": "포르투갈어(브라질)" },
  en: { ko: "Korean", en: "English", ja: "Japanese", "zh-CN": "Chinese (Simplified)", es: "Spanish", fr: "French", de: "German", "pt-BR": "Portuguese (Brazil)" },
  ja: { ko: "韓国語", en: "英語", ja: "日本語", "zh-CN": "中国語（簡体字）", es: "スペイン語", fr: "フランス語", de: "ドイツ語", "pt-BR": "ポルトガル語（ブラジル）" },
};

const aspectRatioNames: Record<SiteLocale, Record<VideoAspectRatio, string>> = {
  ko: { "16:9": "가로모드", "5:4": "가로 5:4", "1:1": "정사각형", "4:5": "세로형", "9:16": "세로 꽉참" },
  en: { "16:9": "Landscape", "5:4": "Landscape 5:4", "1:1": "Square", "4:5": "Portrait", "9:16": "Full portrait" },
  ja: { "16:9": "横向き", "5:4": "横向き 5:4", "1:1": "正方形", "4:5": "縦向き", "9:16": "縦画面いっぱい" },
};

export function outputLanguageName(code: OutputLanguage, locale: SiteLocale) {
  return outputLanguageNames[locale][code];
}

export function aspectRatioName(value: VideoAspectRatio, locale: SiteLocale) {
  return aspectRatioNames[locale][value];
}
