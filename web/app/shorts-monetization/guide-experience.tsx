"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { textFor } from "@/lib/shorts-guides/catalog";
import { useGuideRecommendation } from "./guide-recommendation";
import { initializeGuideAnalytics } from "@/lib/shorts-analytics/client";
import s from "./monetization.module.css";
export function GuideExperience({ children }: { children: ReactNode }) {
  const { active, setActive } = useGuideRecommendation();
  useEffect(() => {
    initializeGuideAnalytics();
    const revealQuiz = () => {
      if (location.hash === "#find-my-way") setActive(true);
    };
    revealQuiz();
    window.addEventListener("hashchange", revealQuiz);
    return () => window.removeEventListener("hashchange", revealQuiz);
  }, [setActive]);
  return (
    <div className={s.experience} data-active={active}>
      {children}
    </div>
  );
}
export function StartQuizButton({ compact = false }: { compact?: boolean }) {
  const { setActive, resume } = useGuideRecommendation();
  const { locale } = useI18n();
  const labels =
    resume === "result"
      ? ["내 결과 다시 보기", "View my saved plan", "保存した結果を見る"]
      : resume === "draft"
        ? ["이어서 답변하기", "Continue my answers", "続きから答える"]
        : [
            "무료로 내 수익화 방법 찾아보기",
            "Find my way to earn for free",
            "自分に合う収益化の方法を無料で探す",
          ];
  return (
    <button
      type="button"
      className={
        compact ? s.navStart : `${s.primaryButton} easycut-private-entry`
      }
      onClick={() => {
        setActive(true);
        requestAnimationFrame(() => {
          const target = document.getElementById("find-my-way");
          (
            target?.closest('[data-questionnaire="true"]') || target
          )?.scrollIntoView({ block: "start" });
        });
      }}
    >
      {textFor(labels as [string, string, string], locale)}{" "}
      <span aria-hidden="true">→</span>
    </button>
  );
}
export function BrowsePanel({
  target,
  title,
  description,
  children,
}: {
  target: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function reveal(hash: string) {
      let id: string;
      try {
        id = decodeURIComponent(hash.slice(1));
      } catch {
        return;
      }
      const node = id ? document.getElementById(id) : null;
      if (!node || !ref.current?.contains(node)) return;
      ref.current.open = true;
      requestAnimationFrame(() => node.scrollIntoView({ block: "start" }));
    }
    const hashChange = () => reveal(location.hash);
    const click = (e: MouseEvent) => {
      const a = (e.target as Element)?.closest?.("a[href]");
      if (!a) return;
      const url = new URL(a.getAttribute("href")!, location.href);
      if (url.origin === location.origin && url.pathname === location.pathname)
        reveal(url.hash);
    };
    hashChange();
    window.addEventListener("hashchange", hashChange);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("hashchange", hashChange);
      document.removeEventListener("click", click);
    };
  }, []);
  return (
    // Browsers may open a details ancestor for a URL fragment before hydration.
    <details
      ref={ref}
      className={s.browsePanel}
      data-panel={target}
      suppressHydrationWarning
    >
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <span aria-hidden="true" className={s.faqPlus} />
      </summary>
      <div>{children}</div>
    </details>
  );
}
