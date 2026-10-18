"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { SiteLocale } from "@/lib/i18n/config";
import { youtubeLaunchCopy } from "./youtube-launch-copy";
import Image from "next/image";
import "./youtube-launch-guide.css";

export const YOUTUBE_LAUNCH_SEEN_KEY = "easycut:youtube-launch:2026-09:completed";

const steps = [
  {
    title: "이제 유튜브에 바로 업로드",
    description: "프로젝트에서 완성한 쇼츠의 ‘업로드’를 누르면, 내 유튜브 채널로 바로 올릴 수 있어요.",
    image: "connect-focused.png",
    width: 1149, height: 537,
    alt: "YouTube 채널 연결하기 버튼",
  },
  {
    title: "제목과 설명도 간편하게 입력",
    description: "업로드 전에 제목과 설명을 한곳에서 수정할 수 있어요.",
    image: "title-description.png",
    width: 1149, height: 906,
    alt: "영상 제목과 설명을 간편하게 입력하는 화면",
  },
  {
    title: "공개 범위도 원하는 대로",
    description: "공개·일부 공개·비공개를 선택할 수 있어요.",
    image: "privacy-detail.png",
    width: 1149, height: 957,
    alt: "공개 범위와 콘텐츠 정보 선택",
  },
] as const;

/** Public, browser-scoped announcement. Preview never reads or writes completion. */
export function YoutubeLaunchGuide({ preview = false, onDismiss, locale = "ko" }: { preview?: boolean; onDismiss?: () => void; locale?: SiteLocale }) {
  const c = youtubeLaunchCopy(locale);
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    let seen = false;
    try { seen = !preview && localStorage.getItem(YOUTUBE_LAUNCH_SEEN_KEY) === "yes"; } catch { /* Optional storage. */ }
    if (seen) dismissRef.current?.();
    else setVisible(true);
  }, [preview]);

  useEffect(() => {
    if (!visible) return;
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    heading.current?.focus();
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [visible]);

  function dismiss() {
    if (!preview) {
      try { localStorage.setItem(YOUTUBE_LAUNCH_SEEN_KEY, "yes"); } catch { /* Still allow closing. */ }
    }
    setVisible(false);
    dismissRef.current?.();
  }

  function changeStep(next: number) {
    setStep(next);
    heading.current?.focus();
  }

  if (!visible) return null;
  const current = { ...steps[step], title: c.steps[step][0], description: c.steps[step][1], alt: c.steps[step][2] };
  return <dialog ref={dialog} className="yt-launch" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <div className="yt-launch-handle" aria-hidden="true" />
    <header className="yt-launch-header">
      <h2 id={titleId}><svg className="yt-launch-sparkle" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" fill="currentColor"/></svg><span>{c.title}</span></h2>
      <button type="button" className="yt-launch-close" aria-label={c.close} onClick={() => dismiss()}>×</button>
    </header>
    <section className="yt-launch-content" aria-label={`${c.step} ${step + 1}`}>
      <div className="yt-launch-copy" aria-live="polite" aria-atomic="true"><h3 ref={heading} tabIndex={-1}><span className="yt-launch-step-number" data-step={step + 1}><span>{step + 1}</span></span>{current.title}</h3><p id={descriptionId}>{current.description}</p></div>
      <div className={`yt-launch-shot${step === 0 ? " yt-launch-flow" : ""}`}>
        {step === 0 && <>
          <Image className="yt-launch-project-actions" src="/updates/youtube-launch/project-actions.png" width={900} height={270} alt={c.actionAlt} priority unoptimized />
          <svg className="yt-launch-flow-arrow" aria-hidden="true" width="22" height="24" viewBox="0 0 22 24" fill="none"><path d="M11 3v17m-6-6 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </>}
        <Image className={step === 0 ? "yt-launch-connect-image" : undefined} src={`/updates/youtube-launch/${current.image}`} width={current.width} height={current.height} alt={current.alt} priority unoptimized />
      </div>
    </section>
    <footer className="yt-launch-footer">
      <span className="yt-launch-counter" aria-label={`${c.step} ${step + 1} / 3`}>{step + 1} <span>/ 3</span></span>
      <div>{step > 0 && <button type="button" className="yt-launch-back" onClick={() => changeStep(step - 1)}>{c.previous}</button>}
        <button type="button" className="yt-launch-next" onClick={() => step === 2 ? dismiss() : changeStep(step + 1)}>{step === 2 ? c.done : c.next}</button></div>
    </footer>
  </dialog>;
}


export function YoutubeLaunchGuideReplay({ locale = "ko" }: { locale?: SiteLocale }) {
  const c = youtubeLaunchCopy(locale);
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="yt-launch-next" onClick={() => setOpen(true)}>{c.replay}</button>
    {open ? <YoutubeLaunchGuide preview locale={locale} onDismiss={() => setOpen(false)} /> : null}
  </>;
}
