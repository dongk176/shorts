"use client";

import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { jaModel, Parser } from "budoux";
import type { SiteLocale } from "@/lib/i18n/config";
import {
  HERO_ROTATION_INTERVAL_MS,
  heroAudienceForOccupation,
  heroHeadlines,
  type HeroAudience,
  type HeroHeadline,
} from "@/lib/i18n/hero-headlines";
import {
  parseUserOccupation,
  USER_ONBOARDING_UPDATED_EVENT,
  type UserOccupation,
  type UserOnboardingStatus,
} from "@/lib/user-onboarding";
import { useUsageState } from "@/components/usage-provider";
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

const rotationLabels = {
  ko: { pause: "제목 자동 전환 일시정지", play: "제목 자동 전환 재생" },
  en: { pause: "Pause headline rotation", play: "Resume headline rotation" },
  ja: { pause: "見出しの自動切り替えを停止", play: "見出しの自動切り替えを再開" },
} as const;

type HeroCopyProps = {
  locale: SiteLocale;
  fallback: HeroHeadline;
  description: string;
};

// Kept separate from the app so a 3-second tick never rerenders the editor/form.
export function HomeHeroPresentation({ audience, locale, fallback, description }: HeroCopyProps & {
  audience: HeroAudience | null;
}) {
  const headlines: readonly HeroHeadline[] = audience ? heroHeadlines[locale][audience] : [fallback];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = headlines.length;

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPaused(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused || count < 2) return;
    let timer: number | undefined;
    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clear();
      if (document.hidden) return;
      timer = window.setTimeout(() => {
        setIndex((current) => (current + 1) % count);
        schedule();
      }, HERO_ROTATION_INTERVAL_MS);
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [count, paused]);

  return (
    <div className={styles.root} lang={locale} data-i18n-skip data-hero-audience={audience ?? "general"}>
      <div className={styles.heading}>
        <h1 className={styles.title} aria-label={headlines[0].join(" ")}>
          <span className={styles.stage} aria-hidden="true">
            {headlines.map((headline, headlineIndex) => (
              <span
                key={headlineIndex}
                className={`${styles.slide} ${headlineIndex === index ? styles.active : ""}`}
                data-hero-slide={headlineIndex}
                data-active={headlineIndex === index}
              >
                <span className={styles.line}><NaturalText text={headline[0]} locale={locale} /></span>
                <span className={`${styles.line} ${styles.accent}`}><NaturalText text={headline[1]} locale={locale} /></span>
              </span>
            ))}
          </span>
        </h1>
        {count > 1 ? (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setPaused((current) => !current)}
            aria-label={paused ? rotationLabels[locale].play : rotationLabels[locale].pause}
            title={paused ? rotationLabels[locale].play : rotationLabels[locale].pause}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
              {paused ? <path d="M3 1.5v9L10 6z" /> : <path d="M2 1h3v10H2zm5 0h3v10H7z" />}
            </svg>
          </button>
        ) : null}
      </div>
      <p className={styles.description}><NaturalText text={description} locale={locale} /></p>
    </div>
  );
}

export function HomeHero({ accountId, ...copy }: HeroCopyProps & { accountId: string | null }) {
  const [profile, setProfile] = useState<{ accountId: string; occupation: UserOccupation | null } | null>(null);
  useEffect(() => {
    if (!accountId) return;
    let disposed = false;
    let controller: AbortController | undefined;
    let timeout: number | undefined;
    const cancel = () => {
      controller?.abort();
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
    const refresh = async () => {
      cancel();
      const request = new AbortController();
      controller = request;
      timeout = window.setTimeout(() => request.abort(), 8_000);
      try {
        const response = await fetch("/api/onboarding", {
          credentials: "same-origin", cache: "no-store", signal: request.signal,
        });
        if (!response.ok) return;
        const status = await response.json() as UserOnboardingStatus;
        if (!disposed && !request.signal.aborted) {
          setProfile({ accountId, occupation: parseUserOccupation(status.occupation) });
        }
      } catch {
        // Personalization must not block the upload form if onboarding is unavailable.
      } finally {
        if (controller === request && timeout !== undefined) window.clearTimeout(timeout);
      }
    };
    const onCompleted = (event: Event) => {
      if ((event as CustomEvent<{ accountId?: string }>).detail?.accountId === accountId) void refresh();
    };
    void refresh();
    window.addEventListener(USER_ONBOARDING_UPDATED_EVENT, onCompleted);
    return () => {
      disposed = true;
      cancel();
      window.removeEventListener(USER_ONBOARDING_UPDATED_EVENT, onCompleted);
    };
  }, [accountId]);
  const occupation = profile?.accountId === accountId ? profile?.occupation ?? null : null;
  const audience = heroAudienceForOccupation(occupation);
  return <HomeHeroPresentation key={`${accountId}:${copy.locale}:${audience}`} {...copy} audience={audience} />;
}

// The onboarding event uses the app account ID, not the authentication provider ID.
export function PersonalizedHomeHero(copy: HeroCopyProps) {
  const { accountId } = useUsageState();
  return <HomeHero {...copy} accountId={accountId} />;
}
