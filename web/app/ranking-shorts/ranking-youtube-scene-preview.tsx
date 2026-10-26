"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { RankingFraming } from "@/lib/ranking-framing";
import { RankingFramedMedia } from "./ranking-framed-media";
import { rankingCropSize } from "@/lib/ranking-crop";
import { rankingDesign, type RankingStyle } from "@/lib/ranking-templates";
import { rankingTime, type RankingSource } from "@/lib/ranking-shorts";
import { RankingRemotePlayer, type RankingRemoteHandle } from "./ranking-remote-player";
import { RankingOverlay } from "./ranking-overlay";

export type RankingPreviewSeek = { sourceId: string; time: number; revision: number };

// Selected scene only. Playback stays inside YouTube; no resolve/prepare/media API.
export function RankingYouTubeScenePreview({ source, start, end, seek, title, subtitle, count, labels, rank, descending, style, suspended, pauseSignal, onStart, onDuration, framing, controlsBelow = false }: {
  framing?: RankingFraming;
  controlsBelow?: boolean;
  source: RankingSource;
  start: number;
  end: number;
  seek: RankingPreviewSeek | null;
  title: string;
  subtitle: string;
  count: number;
  labels: string[];
  rank: number;
  descending: boolean;
  style: RankingStyle;
  suspended: boolean;
  pauseSignal: number;
  onStart: () => void;
  onDuration?: (duration: number) => void;
}) {
  const player = useRef<RankingRemoteHandle>(null);
  const intent = useRef(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [needsPlay, setNeedsPlay] = useState(false);
  const [position, setPosition] = useState(start);
  const [failure, setFailure] = useState(false);
  const [retry, setRetry] = useState(0);
  const [aspect, setAspect] = useState({ width: source.width, height: source.height });
  const cursor = seek?.sourceId === source.id ? seek.time : start;
  const revision = seek?.sourceId === source.id ? seek.revision : 0;
  const revealedRanks = useMemo(() => Array.from({ length: count }, (_, i) => i + 1), [count]);

  useEffect(() => {
    if (source.width > 0 && source.height > 0 || !source.remote) return;
    // Original-aspect public cover supplies geometry only, never the displayed frame.
    // A missing variant's 120x90 placeholder must not turn a Short into landscape.
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive && image.naturalWidth > 120 && image.naturalHeight > 90)
        setAspect({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = `https://i.ytimg.com/vi/${source.remote.videoId}/oardefault.jpg`;
    return () => { alive = false; image.onload = null; };
  }, [source.width, source.height, source.remote]);

  useEffect(() => {
    if (!ready || suspended) return;
    intent.current = false;
    setPlaying(false);
    setFrameReady(false);
    setNeedsPlay(false);
    const target = Math.max(start, Math.min(end - 1 / 30, cursor));
    setPosition(target);
    player.current?.seek(target);
  }, [ready, suspended, start, end, cursor, revision]);

  useEffect(() => {
    intent.current = false;
    setPlaying(false);
    setNeedsPlay(true);
    player.current?.pause();
  }, [pauseSignal]);
  useEffect(() => {
    if (!suspended) return;
    intent.current = false;
    setPlaying(false);
    setReady(false);
    setFrameReady(false);
    player.current?.pause();
  }, [suspended]);

  function toggle() {
    if (!ready || suspended || failure) return;
    if (intent.current) {
      intent.current = false;
      setPlaying(false);
      player.current?.pause();
      return;
    }
    onStart();
    const target = position >= end - 0.08 ? start : Math.max(start, position);
    // Keep seek+play inside the user gesture, including after autoplay was blocked.
    player.current?.seek(target);
    setPosition(target);
    setNeedsPlay(false);
    intent.current = true;
    setPlaying(true);
    player.current?.play();
  }
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey || !ready || suspended || failure ||
        target?.closest('input,textarea,select,button,a,video,audio,[contenteditable="true"],[role="slider"],[role="textbox"]') ||
        document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [ready, suspended, failure]);

  const remotePlayerElement = (<RankingRemotePlayer key={retry} ref={player} composition remote={source.remote!} start={start}
            label={`${rank}위 선택 구간 미리보기`} suspended={suspended}
            onReady={() => { setFailure(false); setReady(true); }}
            onFrame={() => { setFrameReady(true); setNeedsPlay(false); }}
            onPreviewBlocked={() => { intent.current = false; setPlaying(false); setNeedsPlay(true); }}
            onDuration={duration => onDuration?.(duration)}
            onPlaying={() => {}}
            onUnavailable={() => { intent.current = false; setPlaying(false); setFailure(true); }}
            onTime={time => {
              setPosition(Math.max(start, Math.min(end, time)));
              if (intent.current && time >= end - 0.03) {
                intent.current = false;
                setPlaying(false);
                player.current?.pause();
                setPosition(end);
              }
            }} />);
  const compositionStyle = { "--ranking-video-top": `${rankingDesign.layout.headerHeight / rankingDesign.layout.height * 100}%` } as CSSProperties;
  return <div className="ranking-sequence-preview ranking-youtube-scene-preview">
    <div className="ranking-composition" style={compositionStyle}>
      {controlsBelow ? <RankingFramedMedia width={aspect.width} height={aspect.height} framing={framing}>
        {remotePlayerElement}
      </RankingFramedMedia> : (<div className="ranking-youtube-crop">
        <div className="ranking-youtube-crop-frame" style={rankingCropSize(aspect.width, aspect.height)}>
          {remotePlayerElement}
        </div>
      </div>)}

      <RankingOverlay title={title} subtitle={subtitle} count={count} active={rank - 1}
        labels={labels} descending={descending} style={style}
        revealedRanks={revealedRanks} />
      {!frameReady && !failure ? <div className="ranking-scene-preview-loading" role="status">{ready && needsPlay ? "재생을 눌러 장면을 확인하세요" : <><span className="ranking-spinner" />장면 연결 중…</>}</div> : null}
      {failure ? <div className="ranking-scene-preview-loading" role="alert">
        <p>장면을 연결하지 못했어요.</p>
        <button type="button" onClick={() => { setFailure(false); setReady(false); setFrameReady(false); setNeedsPlay(false); setRetry(value => value + 1); }}>다시 연결</button>
      </div> : null}
      {!controlsBelow && (<button type="button" className="ranking-preview-toggle" disabled={!ready || suspended || failure}
        aria-label={playing ? "선택 구간 미리보기 일시 정지" : "선택 구간 미리보기 재생"} aria-keyshortcuts="Space" onClick={toggle}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">{playing ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor" /> : <path d="m9 5 11 7-11 7z" fill="currentColor" />}</svg>
      </button>)}
    </div>
    {controlsBelow && <div className="ranking-preview-transport"><button type="button" className="ranking-preview-toggle" disabled={!ready || suspended || failure}
        aria-label={playing ? "선택 구간 미리보기 일시 정지" : "선택 구간 미리보기 재생"} aria-keyshortcuts="Space" onClick={toggle}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">{playing ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor" /> : <path d="m9 5 11 7-11 7z" fill="currentColor" />}</svg>
      </button></div>}

    <div className="ranking-sequence-controls"><span>{rank}위 선택 구간 · {rankingTime(Math.max(0, position - start))} / {rankingTime(end - start)}</span></div>
  </div>;
}
