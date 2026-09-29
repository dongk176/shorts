export type YoutubeAttribution = { title: string; author: string; url: string; ccBy: boolean };
export const CC_BY_URL = "https://www.youtube.com/t/creative_commons";
export function attributionDescription(source: YoutubeAttribution | null | undefined, locale = "ko") {
  if (!source) return "";
  const credit = [source.author, source.title].filter(Boolean).join(" — ").replace(/[<>\r\n]/g, " ");
  const edited = locale === "en" ? "Excerpted from the original and edited into a vertical video."
    : locale === "ja" ? "元動画を抜粋して縦動画に編集しました。" : "원본을 발췌해 세로 영상으로 편집했어요.";
  return [credit, source.url, ...(source.ccBy ? [`CC BY · ${CC_BY_URL}`] : []), edited].join("\n");
}
