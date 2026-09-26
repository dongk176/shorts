import { type SiteLocale, localizedValue } from "@/lib/i18n/config";
import { showcaseSources } from "@/lib/showcase-sources";

type ShowcaseCredit = { url: string; author: string; title: string };

export function ShowcaseCredits({ locale, videoTitle, sources: suppliedSources }: { locale: SiteLocale; videoTitle?: string; sources?: ShowcaseCredit[] }) {
  const legacySources = videoTitle
    ? [...showcaseSources.en, ...showcaseSources.ja].filter((source) => source.title === videoTitle)
    : locale === "ko" ? [] : showcaseSources[locale];
  const sources = suppliedSources ?? legacySources.map((source) => ({ ...source, url: `https://www.youtube.com/watch?v=${source.videoId}` }));
  if (!sources.length) return null;
  return (
    <details className="mx-auto mt-5 max-w-3xl px-5 text-xs leading-6 text-neutral-400">
      <summary className="cursor-pointer text-center hover:text-white">
        {localizedValue(locale, { ko: "영상 출처", en: "Video credits", ja: "使用動画・クレジット" })}
      </summary>
      <ul className="mt-3 space-y-2">
        {sources.map((source) => (
          <li key={source.url}>
            <a className="underline hover:text-white" href={source.url} target="_blank" rel="noreferrer">
              {source.author} — {source.title}
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-2">
        <a className="underline" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Creative Commons Attribution 4.0 (CC BY)</a>
        {localizedValue(locale, { ko: " · Easy Cut으로 발췌·편집했습니다. 제목과 댓글 형식의 문구는 AI가 생성했습니다.", en: " · Excerpts edited with Easy Cut. Titles and comment overlays are AI-generated.", ja: " · Easy Cutで抜粋・編集しています。タイトルとコメント風テキストはAIが生成したものです。" })}
      </p>
    </details>
  );
}
