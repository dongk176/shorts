"use client";

import { Fragment, memo, useMemo } from "react";
import { jaModel, Parser } from "budoux";
import type { SiteLocale } from "@/lib/i18n/config";
import styles from "./home-hero.module.css";

let japaneseParser: Parser | undefined;
export function japaneseHeroPhrases(text: string): string[] {
  japaneseParser ??= new Parser(jaModel);
  // These lead-in phrases can otherwise be joined to the entire following verb,
  // creating a chunk wider than a narrow mobile headline.
  const phrases = japaneseParser.parse(text).flatMap((phrase) => phrase.split(/(?<=そろそろ)|(?<=トレンド)/u));
  const joined: string[] = [];
  const katakana = /[ァ-ヺーｦ-ﾟ]/u;
  for (const phrase of phrases) {
    const previous = joined.at(-1);
    // Preserve loanwords such as ショート when the statistical parser suggests
    // a boundary inside the katakana run (ショー / ト動画を).
    if (previous && katakana.test(previous.slice(-1)) && katakana.test(phrase[0] ?? "")) {
      joined[joined.length - 1] = previous + phrase;
    } else joined.push(phrase);
  }
  return joined;
}

const NaturalText = memo(function NaturalText({ text, locale }: { text: string; locale: SiteLocale }) {
  const phrases = useMemo(() => locale === "ja" ? japaneseHeroPhrases(text) : null, [locale, text]);
  if (locale !== "ja") return <>{text.split(/(\s+)/u).map((part, index) =>
    /\s/u.test(part) ? part : <span key={index} className={styles.phrase} data-hero-phrase>{part}</span>
  )}</>;
  if (!phrases) return <>{text}</>;
  return <>{phrases.map((phrase, index) => (
    <Fragment key={index}>
      <span className={styles.phrase} data-hero-phrase>{phrase}</span>
      {index < phrases.length - 1 ? <wbr /> : null}
    </Fragment>
  ))}</>;
});

type HeroCopyProps = {
  locale: SiteLocale;
  headline: readonly [string, string];
  description: string;
};

export function HomeHero({ locale, headline, description }: HeroCopyProps) {
  return (
    <div className={styles.root} lang={locale} data-i18n-skip>
      <h1 className={styles.title} aria-label={headline.join(" ")}>
        <span className={styles.line}><NaturalText text={headline[0]} locale={locale} /></span>
        <span className={`${styles.line} ${styles.accent}`}><NaturalText text={headline[1]} locale={locale} /></span>
      </h1>
      <p className={styles.description}><NaturalText text={description} locale={locale} /></p>
    </div>
  );
}
