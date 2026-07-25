"use client";

import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { localizedValue } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

const REVEAL_DELAY_MS = 1_900;
const SYNC_THRESHOLD_SECONDS = 0.075;
const AUTOMATIC_PLAY_COUNT = 2;
const SHOWCASE_ASSET_VERSION = "20260721-2";

type TransformationExampleProps = {
  horizontalSrc: string;
  verticalSrc: string;
  label: string;
  active: boolean;
  inView: boolean;
  revealed: boolean;
  showCopy: boolean;
  messageVisible: boolean;
  onFirstPlay: () => void;
};

function TransformationExample({
  horizontalSrc,
  verticalSrc,
  label,
  active,
  inView,
  revealed,
  showCopy,
  messageVisible,
  onFirstPlay,
}: TransformationExampleProps) {
  const { locale } = useI18n();
  const horizontalRef = useRef<HTMLVideoElement>(null);
  const verticalRef = useRef<HTMLVideoElement>(null);
  const hasStartedRef = useRef(false);
  const completedPlayCountRef = useRef(0);
  const playAttemptInFlightRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [requiresReplay, setRequiresReplay] = useState(false);

  const pausePair = useCallback(() => {
    horizontalRef.current?.pause();
    verticalRef.current?.pause();
    setPlaying(false);
  }, []);

  const startPair = useCallback(async () => {
    const horizontal = horizontalRef.current;
    const vertical = verticalRef.current;
    if (!horizontal || !vertical || playAttemptInFlightRef.current) return;

    horizontal.muted = true;
    horizontal.defaultMuted = true;
    vertical.muted = true;
    vertical.defaultMuted = true;

    if (
      hasStartedRef.current
      && horizontal.readyState >= HTMLMediaElement.HAVE_METADATA
      && vertical.readyState >= HTMLMediaElement.HAVE_METADATA
    ) {
      vertical.currentTime = horizontal.currentTime;
    }

    playAttemptInFlightRef.current = true;
    const results = await Promise.allSettled([horizontal.play(), vertical.play()]);
    playAttemptInFlightRef.current = false;

    if (results.every((result) => result.status === "fulfilled")) {
      setPlaying(true);
      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        onFirstPlay();
      }
      return;
    }

    pausePair();
    setRequiresReplay(true);
  }, [onFirstPlay, pausePair]);

  useEffect(() => {
    if (!active || !inView) {
      pausePair();
      return;
    }
    if (!requiresReplay) void startPair();
  }, [active, inView, pausePair, requiresReplay, startPair]);

  useEffect(() => {
    if (!playing) return;
    let animationFrame = 0;

    const keepInSync = () => {
      const horizontal = horizontalRef.current;
      const vertical = verticalRef.current;
      if (
        horizontal
        && vertical
        && horizontal.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && vertical.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && !horizontal.seeking
        && !vertical.seeking
        && Math.abs(vertical.currentTime - horizontal.currentTime) > SYNC_THRESHOLD_SECONDS
      ) {
        vertical.currentTime = horizontal.currentTime;
      }
      animationFrame = window.requestAnimationFrame(keepInSync);
    };

    animationFrame = window.requestAnimationFrame(keepInSync);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [playing]);

  const handleHorizontalEnded = useCallback(() => {
    const horizontal = horizontalRef.current;
    const vertical = verticalRef.current;
    if (!horizontal || !vertical) return;

    completedPlayCountRef.current += 1;
    pausePair();

    if (completedPlayCountRef.current >= AUTOMATIC_PLAY_COUNT) {
      setRequiresReplay(true);
      return;
    }

    horizontal.currentTime = 0;
    vertical.currentTime = 0;
    if (inView) void startPair();
  }, [inView, pausePair, startPair]);

  const replayAfterLimit = useCallback(() => {
    if (!requiresReplay || !inView) return;
    const horizontal = horizontalRef.current;
    const vertical = verticalRef.current;
    if (!horizontal || !vertical) return;

    completedPlayCountRef.current = 0;
    horizontal.currentTime = 0;
    vertical.currentTime = 0;
    setRequiresReplay(false);
    void startPair();
  }, [inView, requiresReplay, startPair]);

  const handleReplayKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    replayAfterLimit();
  };

  const replayFrameProps = requiresReplay
    ? {
        className: "transformation-video-frame is-replay-ready",
        role: "button",
        tabIndex: 0,
        "aria-label": localizedValue(locale, { ko: "쇼케이스 영상 다시 재생", en: "Replay showcase video", ja: "ショーケース動画を再生" }),
        onClick: replayAfterLimit,
        onKeyDown: handleReplayKeyDown,
      }
    : { className: "transformation-video-frame" };
  const playPrompt = localizedValue(locale, {
    ko: "탭해서 재생",
    en: "Tap to play",
    ja: "タップして再生",
  });

  return (
    <div
      className={`transformation-stage${revealed ? " is-revealed" : ""}`}
      role="group"
      aria-label={label}
      hidden={!active}
    >
        <figure className="transformation-source-panel">
          {showCopy && (
            <div
              className={`transformation-source-message${messageVisible ? " is-visible" : ""}`}
              aria-hidden={!messageVisible}
            >
              <p>
                <span>{localizedValue(locale, { ko: "클릭 한 번으로", en: "One click handles", ja: "ワンクリックで" })}</span>{" "}
                <span>{localizedValue(locale, { ko: "편집부터", en: "editing through", ja: "編集から" })}</span>{" "}
                <span>{localizedValue(locale, { ko: "리얼한 댓글 생성까지", en: "realistic comment creation", ja: "リアルなコメント作成まで" })}</span>
              </p>
              <strong>
                <span>{localizedValue(locale, { ko: "AI가", en: "AI does", ja: "AIが" })}</span>{" "}
                <span>{localizedValue(locale, { ko: "다 해줌", en: "it all", ja: "全部やります" })}</span>
                <em aria-hidden="true">✨</em>
              </strong>
            </div>
          )}
          <div {...replayFrameProps}>
            <video
              ref={horizontalRef}
              src={`${horizontalSrc}?v=${SHOWCASE_ASSET_VERSION}`}
              autoPlay={active && inView && !requiresReplay}
              muted
              playsInline
              preload={active ? "auto" : "none"}
              onEnded={handleHorizontalEnded}
              onPlay={() => {
                setPlaying(true);
                if (!hasStartedRef.current) {
                  hasStartedRef.current = true;
                  onFirstPlay();
                }
              }}
              aria-label={localizedValue(locale, { ko: `${label} 가로 원본 영상`, en: `${label} horizontal source video`, ja: `${label} 横向き元動画` })}
            />
            {requiresReplay && <span className="transformation-play-prompt" aria-hidden="true"><span>▶</span>{playPrompt}</span>}
          </div>
          {showCopy && (
            <p
              className={`transformation-source-caption${messageVisible ? " is-visible" : ""}`}
              aria-hidden={!messageVisible}
            >
              {localizedValue(locale, { ko: "롱폼 1개", en: "1 long video", ja: "長尺動画1本" })} <span aria-hidden="true">➡</span> {localizedValue(locale, { ko: "쇼츠 10개", en: "10 Shorts", ja: "ショート動画10本" })}
            </p>
          )}
        </figure>

        <div className="transformation-flow-arrow" aria-hidden="true">
          <span>→</span>
        </div>

        <figure className="transformation-result-panel">
          <div {...replayFrameProps}>
            <video
              ref={verticalRef}
              src={`${verticalSrc}?v=${SHOWCASE_ASSET_VERSION}`}
              autoPlay={active && inView && !requiresReplay}
              muted
              playsInline
              preload={active ? "auto" : "none"}
              aria-label={localizedValue(locale, { ko: `${label} 세로로 편집된 완성 쇼츠`, en: `${label} finished vertical Short`, ja: `${label} 縦向きに編集した完成動画` })}
            />
            {requiresReplay && <span className="transformation-play-prompt" aria-hidden="true"><span>▶</span>{playPrompt}</span>}
          </div>
        </figure>

    </div>
  );
}

export function TransformationShowcase() {
  const { locale } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const revealStartedRef = useRef(false);
  const revealTimerRef = useRef<number | null>(null);
  const [inView, setInView] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [messageVisible, setMessageVisible] = useState(false);
  const [selectedExample, setSelectedExample] = useState<"first" | "second" | null>(null);

  useEffect(() => {
    setSelectedExample(Math.random() < 0.5 ? "first" : "second");
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting) setMessageVisible(true);
    }, { threshold: 0.25 });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const beginReveal = useCallback(() => {
    if (revealStartedRef.current) return;
    revealStartedRef.current = true;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }

    revealTimerRef.current = window.setTimeout(() => {
      setRevealed(true);
      revealTimerRef.current = null;
    }, REVEAL_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (revealTimerRef.current !== null) window.clearTimeout(revealTimerRef.current);
  }, []);

  return (
    <section
      ref={sectionRef}
      className="transformation-showcase-section"
      aria-label={localizedValue(locale, { ko: "가로 영상을 세로 쇼츠로 변환하는 예시", en: "Example of turning a horizontal video into vertical Shorts", ja: "横向き動画を縦型ショート動画に変換する例" })}
    >
      <div className="transformation-showcase-row">
        <div className="transformation-stage-glow transformation-stage-glow-left" aria-hidden="true" />
        <div className="transformation-stage-glow transformation-stage-glow-right" aria-hidden="true" />
        {selectedExample === null && (
          <div className="transformation-stage" aria-hidden="true" />
        )}
        <TransformationExample
          horizontalSrc="/transformation-showcase/ditto-horizontal.mp4"
          verticalSrc="/transformation-showcase/ditto-vertical.mp4"
          label={localizedValue(locale, { ko: "첫 번째 변환 예시", en: "First transformation example", ja: "1つ目の変換例" })}
          active={selectedExample === "first"}
          inView={inView}
          revealed={revealed}
          showCopy
          messageVisible={messageVisible}
          onFirstPlay={beginReveal}
        />
        <TransformationExample
          horizontalSrc="/transformation-showcase/urgency-horizontal.mp4"
          verticalSrc="/transformation-showcase/urgency-vertical.mp4"
          label={localizedValue(locale, { ko: "두 번째 변환 예시", en: "Second transformation example", ja: "2つ目の変換例" })}
          active={selectedExample === "second"}
          inView={inView}
          revealed={revealed}
          showCopy
          messageVisible={messageVisible}
          onFirstPlay={beginReveal}
        />
      </div>
    </section>
  );
}
