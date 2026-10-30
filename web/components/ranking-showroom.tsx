"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";

import Link from "@/lib/i18n/navigation";
import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import englishSamples from "./ranking-showroom-en.json";
import { useNavigationLocale } from "@/lib/i18n/provider";
import originalSamples from "./ranking-showroom-data.json";
import styles from "./ranking-showroom.module.css";

function Arrow({ right = false }: { right?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={right ? "m9 5 7 7-7 7" : "m15 5-7 7 7 7"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function RankingIcon() {
  return <svg className={styles.rankingIcon} width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 21h18M4 21V11h5v10M9 21V4h6v17M15 21v-7h5v7" /></svg>;
}
function SoundIcon({ muted }: { muted: boolean }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m11 5-5 4H3v6h3l5 4V5Z" />{muted ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}</svg>;
}

function SourceStrip({ sources }: { sources: (typeof originalSamples)[number]["sources"] }) {
  const ui = useUiText();
  const strip = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const duration = useRef(0);
  const mayRun = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ id: number; x: number } | null>(null);
  const [inView, setInView] = useState(false);
  const [focused, setFocused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [reduced, setReduced] = useState(false);
  const flowing = sources.length >= 3;
  const running = flowing && inView && !focused && !reduced && !interacting;

  useEffect(() => {
    const node = strip.current;
    if (!node) return;
    let intersects = false;
    const sync = () => setInView(intersects && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { intersects = entry.isIntersecting; sync(); }, { threshold: 0.1 });
    observer.observe(node);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(motion.matches);
    updateMotion();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); motion.removeEventListener("change", updateMotion); document.removeEventListener("visibilitychange", sync); if (resumeTimer.current) clearTimeout(resumeTimer.current); };
  }, []);

  useEffect(() => {
    mayRun.current = running;
    if (running) animation.current?.play();
    else animation.current?.pause();
  }, [running]);

  useEffect(() => {
    const node = strip.current;
    const row = track.current;
    if (!node || !row || !flowing) return;
    const measure = () => {
      const first = row.children[0] as HTMLElement;
      const copy = row.children[sources.length] as HTMLElement;
      // Retain fractional layout pixels so the duplicate joins without a jump.
      const distance = copy.getBoundingClientRect().left - first.getBoundingClientRect().left;
      if (distance <= 0) return;
      const progress = duration.current ? (Number(animation.current?.currentTime ?? 0) % duration.current) / duration.current : 0;
      animation.current?.cancel();
      duration.current = distance / 44 * 1000;
      const next = row.animate([{ transform: "translate3d(0,0,0)" }, { transform: `translate3d(${-distance}px,0,0)` }], { duration: duration.current, iterations: Infinity, easing: "linear" });
      next.pause();
      next.currentTime = progress * duration.current;
      animation.current = next;
      if (mayRun.current) next.play();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => { observer.disconnect(); animation.current?.cancel(); animation.current = null; };
  }, [flowing, sources.length]);

  const hold = useCallback(() => {
    animation.current?.pause();
    setInteracting(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setInteracting(false), 2500);
  }, []);
  const move = useCallback((delta: number) => {
    const player = animation.current;
    if (!player || !duration.current) return;
    hold();
    const time = Number(player.currentTime ?? 0) + delta / 44 * 1000;
    player.currentTime = ((time % duration.current) + duration.current) % duration.current;
  }, [hold]);

  useEffect(() => {
    const node = strip.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!animation.current || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      move(event.deltaX * (event.deltaMode === 1 ? 16 : 1));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [move]);

  return <div className={styles.sources}>
    <div className={styles.mediaLabel}>{ui("원본 영상")}<span>{ui(`${sources.length}개`)}</span></div>
    <div ref={strip} className={styles.sourceStrip} tabIndex={0} role="region" aria-label={`${ui("원본 영상")} ${sources.length}, ${ui("좌우로 넘겨보기")}`} data-flowing={flowing} onPointerDown={event => { if (!flowing || event.button !== 0) return; hold(); drag.current = { id: event.pointerId, x: event.clientX }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const previous = drag.current; if (!previous || previous.id !== event.pointerId) return; move(previous.x - event.clientX); previous.x = event.clientX; }} onPointerUp={() => { drag.current = null; hold(); }} onPointerCancel={() => { drag.current = null; hold(); }} onFocus={event => setFocused(event.currentTarget.matches(":focus-visible"))} onBlur={() => setFocused(false)} onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); move(event.key === "ArrowRight" ? 120 : -120); } }}>
      <div ref={track} className={styles.sourceTrack}>
        {[0, ...(flowing ? [1] : [])].map(copy => sources.map(source => <div className={styles.sourceFrame} key={`${copy}-${source.id}`} aria-hidden={copy === 1 ? true : undefined}>
          <Image src={`/ranking-showroom-20/sources/${source.id}.jpg`} alt={copy === 1 ? "" : `${ui("원본 장면")} ${source.rank}`} width={360} height={640} sizes="(max-width: 640px) 202px, 240px" loading="lazy" decoding="async" draggable={false} />
        </div>))}
      </div>
    </div>
  </div>;
}

export function RankingShowroom() {
  const locale = useNavigationLocale();
  const samples = locale === "en" ? englishSamples : originalSamples;
  const mediaRoot = locale === "en" ? "/ranking-showroom-en" : "/ranking-showroom-20";
  const ui = useUiText();
  const id = useId();
  const [selected, setSelected] = useState(0);
  const [visible, setVisible] = useState(false);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const result = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const sample = samples[selected];

  useEffect(() => {
    const target = result.current;
    if (!target) return;
    let inView = false;
    const sync = () => setVisible(inView && document.visibilityState === "visible");
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, { threshold: 0.2 });
    observer.observe(target);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);

  useEffect(() => {
    const player = video.current;
    if (!player) return;
    player.muted = muted;
    if (visible && !paused && !failed) void player.play().catch(() => setPlaying(false));
    else player.pause();
  }, [selected, visible, muted, paused, failed, retry]);

  function choose(index: number, focus = false) {
    setSelected(index); setMuted(true); setPaused(false); setFailed(false);
    tabs.current[index]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    if (focus) tabs.current[index]?.focus({ preventScroll: true });
  }

  return <section id="ranking-showroom" className={styles.section} aria-labelledby={`${id}-title`}>
    <header className={styles.header}>
      <h2 id={`${id}-title`} className={styles.title}><RankingIcon /><span className={styles.titleText}>{ui("랭킹 쇼츠")}</span></h2>
      <div className={styles.navigation} aria-label={ui("다른 랭킹 보기")}>
        <button type="button" aria-label={ui("이전 랭킹")} onClick={() => choose((selected - 1 + samples.length) % samples.length)}><Arrow /></button>
        <button type="button" aria-label={ui("다음 랭킹")} onClick={() => choose((selected + 1) % samples.length)}><Arrow right /></button>
      </div>
    </header>
    <div className={styles.tabs} role="tablist" aria-label={ui("랭킹 쇼츠 종류")}>
      {samples.map((item, index) => <button key={item.name} ref={node => { tabs.current[index] = node; }} id={`${id}-tab-${index}`} type="button" role="tab" aria-controls={`${id}-panel`} aria-selected={index === selected} tabIndex={index === selected ? 0 : -1} onClick={() => choose(index)} onKeyDown={event => {
        let next: number | undefined;
        if (event.key === "ArrowRight") next = (index + 1) % samples.length;
        if (event.key === "ArrowLeft") next = (index - 1 + samples.length) % samples.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = samples.length - 1;
        if (next !== undefined) { event.preventDefault(); choose(next, true); }
      }}>{ui(item.subtitle)}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${selected}`} className={styles.stage}>
      <SourceStrip key={sample.name} sources={sample.sources} />
      <div className={styles.mergeArrow} aria-hidden="true"><svg width="46" height="30" viewBox="0 0 46 30" fill="none"><path d="M2 15h40M29 2l13 13-13 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
      <div ref={result} className={styles.result}>
        <div className={styles.mediaLabel}>{ui("랭킹 쇼츠")}<span>{ui("1개")}</span></div>
        <div className={styles.resultFrame}>
          <video key={`${sample.name}-${retry}`} ref={video} src={`${mediaRoot}/${sample.name}.mp4`} poster={`${mediaRoot}/${sample.name}.jpg`} muted={muted} loop playsInline preload="none" aria-label={`${ui(sample.subtitle)} — ${ui("완성 영상")}`} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setFailed(true)} />
          {failed && <div className={styles.error}><span>{ui("영상을 불러오지 못했어요.")}</span><button type="button" onClick={() => { setFailed(false); setRetry(value => value + 1); }}>{ui("다시 재생")}</button></div>}
        </div>
        <div className={styles.controls}>
          <button type="button" aria-label={playing ? ui("랭킹 영상 일시정지") : ui("랭킹 영상 재생")} onClick={() => { if (playing) setPaused(true); else { setPaused(false); void video.current?.play().catch(() => setPlaying(false)); } }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <path d="M6 4h4v16H6zm8 0h4v16h-4z" /> : <path d="m7 3 15 9-15 9z" />}</svg>
          </button>
          <button type="button" aria-pressed={!muted} onClick={() => setMuted(value => !value)}><SoundIcon muted={muted} /><span>{muted ? ui("음소거 해제") : ui("음소거")}</span></button>
        </div>
      </div>
    </div>
    <div className={styles.footer}><Link className={styles.createButton} href="/ranking-shorts" prefetch={false}>{ui("랭킹 쇼츠 만들기")}<Arrow right /></Link></div>
  </section>;
}
