"use client";

import type { SiteLocale } from "@/lib/i18n/config";
import styles from "./home-hero.module.css";

type HeroCopyProps = {
  locale: SiteLocale;
  headline: readonly [string, string];
  description: string;
};

export function HomeHero({ locale, headline, description }: HeroCopyProps) {
  return (
    <div className={styles.root} lang={locale} data-i18n-skip>
      <h1 className={styles.title} aria-label={headline.join(" ")}>
        <span className={styles.line}>{headline[0]}</span>
        <span className={`${styles.line} ${styles.accent}`}>{headline[1]}</span>
      </h1>
      <p className={styles.description}>{description}</p>
    </div>
  );
}
