"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeatureGuideOverlay } from "./feature-guide-overlay";
import { languageCopy, languageGuideSteps } from "@/lib/language-guide";
import type { SiteLocale } from "@/lib/i18n/config";

export function LanguageGuide({ userId, available, enabled, replay, locale, onComplete }: {
  userId: string | null;
  available: boolean;
  enabled: boolean;
  replay: number;
  locale: SiteLocale;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<"loading" | "new" | "done">("loading");
  const [closedReplay, setClosedReplay] = useState(0);
  const checked = useRef(false);
  const steps = useMemo(() => languageGuideSteps(locale), [locale]);
  const copy = languageCopy[locale];
  useEffect(() => {
    if (!available || !userId || checked.current) return;
    try {
      if (localStorage.getItem(`easycut-language-guide:${userId}`) === "1") {
        checked.current = true; setPhase("done"); onComplete(); return;
      }
    } catch { /* Server state remains the fallback. */ }
    let disposed = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    void fetch("/api/language-guide", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Guide unavailable");
        const result = await response.json() as { available: boolean; seen: boolean };
        if (disposed) return;
        checked.current = true;
        setPhase(result.available && !result.seen ? "new" : "done");
        if (!result.available || result.seen) onComplete();
      })
      .catch(() => {
        // A guide outage never blocks creation or reopens repeatedly this visit.
        if (disposed) return;
        checked.current = true; setPhase("done"); onComplete();
      }).finally(() => window.clearTimeout(timer));
    return () => { disposed = true; window.clearTimeout(timer); controller.abort(); };
  }, [available, userId, onComplete]);

  const hidePermanently = useCallback(() => {
    if (!userId) return;
    try { localStorage.setItem(`easycut-language-guide:${userId}`, "1"); } catch { /* Server persistence is still attempted. */ }
    // Persist immediately, with one bounded retry for a transient network error.
    const save = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch("/api/language-guide", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, status: "completed", dontShowAgain: true }), keepalive: true, signal: AbortSignal.timeout(8_000),
          });
          if (response.ok || response.status < 500) return;
        } catch { /* The guide is already closed locally. */ }
      }
    };
    void save();
  }, [userId]);

  const close = useCallback(() => {
    hidePermanently();
    setPhase("done"); setClosedReplay(replay); onComplete();
  }, [hidePermanently, replay, onComplete]);

  return <FeatureGuideOverlay key={replay} enabled={available && enabled && (phase === "new" || replay > closedReplay)}
    steps={steps} closeAriaLabel={copy.close} smoothTransitions onClose={close}
    previousLabel={copy.previous} nextLabel={copy.next} lastStepSecondaryLabel={copy.confirm}
    lastStepPrimaryLabel={copy.dontShowAgain} />;
}
