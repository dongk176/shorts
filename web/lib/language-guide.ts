import type { SiteLocale } from "./i18n/config";
import type { FeatureGuideStep } from "@/components/feature-guide-overlay";

export const languageCopy = {
  ko: {
    heading: "언어 선택", help: "사용 방법", source: "영상 언어", output: "제작 언어", auto: "자동 감지",
    sourceHint: "원본 영상에서 사용하는 음성 언어",
    outputHint: "제목·댓글·스크립트·생성 자막에 사용할 언어",
    preserved: "원본 음성과 영상에 이미 들어간 글자는 유지됩니다.",
    translation: "번역 자막은 자막이 포함된 템플릿을 선택했을 때만 표시되며, 효과 없는 기본형으로 제공됩니다.",
    eyebrow: "언어 선택 안내", sourceTitle: "원본 영상의 언어를 확인해요",
    sourceGuide: "영상 언어는 자동으로 감지해요. 필요하면 한국어·영어·일본어 중 직접 선택할 수 있어요.",
    outputTitle: "어떤 언어로 만들지 선택해요",
    outputGuide: "선택한 언어로 제목·댓글·스크립트·생성 자막을 만들어요. 원본 음성과 영상 속 글자는 유지돼요.",
    close: "언어 안내 닫기", previous: "이전", next: "다음", confirm: "확인", dontShowAgain: "다시 보지 않기",
  },
  en: {
    heading: "Language", help: "How to use", source: "Source language", output: "Output language", auto: "Detect automatically",
    sourceHint: "The language spoken in the original video",
    outputHint: "Language for titles, comments, scripts and generated captions",
    preserved: "The original audio and text already in the video stay the same.",
    translation: "Translated captions appear only when you select a template with captions, using a basic style without effects.",
    eyebrow: "LANGUAGE GUIDE", sourceTitle: "Check the original video's language",
    sourceGuide: "We detect the video language automatically. You can also choose Korean, English or Japanese.",
    outputTitle: "Choose the output language",
    outputGuide: "Titles, comments, scripts and generated captions use this language. The original audio and text in the video stay the same.",
    close: "Close language guide", previous: "Back", next: "Next", confirm: "Confirm", dontShowAgain: "Don't show again",
  },
  ja: {
    heading: "言語選択", help: "使い方", source: "元動画の言語", output: "出力言語", auto: "自動検出",
    sourceHint: "元の動画で話されている言語",
    outputHint: "タイトル・コメント・スクリプト・生成字幕に使う言語",
    preserved: "元の音声と動画内にすでにある文字はそのままです。",
    translation: "翻訳字幕は字幕付きテンプレートを選んだ場合のみ、エフェクトなしの基本スタイルで表示します。",
    eyebrow: "言語選択ガイド", sourceTitle: "元の動画の言語を確認しましょう",
    sourceGuide: "動画の言語は自動で検出します。必要に応じて韓国語・英語・日本語を選べます。",
    outputTitle: "出力する言語を選びましょう",
    outputGuide: "選んだ言語でタイトル・コメント・スクリプト・生成字幕を作ります。元の音声と動画内の文字はそのままです。",
    close: "言語ガイドを閉じる", previous: "戻る", next: "次へ", confirm: "確認", dontShowAgain: "今後表示しない",
  },
} as const;

export function languageGuideSteps(locale: SiteLocale): FeatureGuideStep[] {
  const copy = languageCopy[locale];
  return [
    { id: "video-language", eyebrow: copy.eyebrow, title: copy.sourceTitle, description: copy.sourceGuide,
      targetSelector: "[data-language-source]", placement: "below", scrollBlock: "center" },
    { id: "creation-language", eyebrow: copy.eyebrow, title: copy.outputTitle, description: copy.outputGuide,
      targetSelector: "[data-language-output]", placement: "below", scrollBlock: "center" },
  ];
}
