"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useUiText } from "@/lib/i18n/use-ui-text";
import type { RankingSlot } from "@/lib/ranking-draft";
import { RANKING_LIMITS } from "@/lib/ranking-shorts";
import { RankingFramingEditor } from "./ranking-framing-editor";
import { RankingTimeline } from "./ranking-timeline";
import { RankingRemotePlayer, type RankingRemoteHandle } from "./ranking-remote-player";

type Props = {
  slot: RankingSlot; rank: number; active: boolean; suspended: boolean;
  project: string | null; localMedia: Record<string, string>;
  player: RefObject<HTMLVideoElement | null>; remotePlayer: RefObject<RankingRemoteHandle | null>;
  onChange: (changes: Partial<RankingSlot>) => void; onError: (message: string) => void;
  onStart: () => void; onSeek: (time: number) => void; onImport: () => void; onPrepare: () => void;
};

// Retain only visited editors. Switching ranks must not recreate the video or
// the ten filmstrip frames. Removing/replacing a source still releases both.
export function RankingSourceEditor(props: Props) {
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (props.active) setVisited(true); }, [props.active]);
  return <div hidden={!props.active}>
    {visited || props.active ? <SourceSession {...props} /> : null}
  </div>;
}

function SourceSession({ slot, rank, active, suspended, project, localMedia, player, remotePlayer, onChange, onError, onStart, onSeek, onImport, onPrepare }: Props) {
  const ui = useUiText();
  const video = useRef<HTMLVideoElement>(null);
  const remote = useRef<RankingRemoteHandle>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState(slot.start);
  const enabled = useRef(active && !suspended);
  enabled.current = active && !suspended;
  const source = slot.source!;
  const isRemote = Boolean(source.remote && !source.previewReady);
  const url = localMedia[source.id] || (!isRemote && project ? `/api/ranking-shorts/${project}/media/${source.id}` : "");
  const start = useRef(slot.start);
  start.current = slot.start;
  useEffect(() => {
    if (!active || suspended) { video.current?.pause(); remote.current?.pause(); }
    if (!active) return;
    player.current = video.current; remotePlayer.current = remote.current;
    const media = video.current;
    if (media && media.readyState >= 1) { media.currentTime = start.current; setCurrent(start.current); setReady(true); }
    return () => {
      media?.pause();
      if (player.current === media) player.current = null;
    };
  }, [active, suspended, player, remotePlayer, url]);
  function seek(time: number) {
    if (isRemote) { remote.current?.pause(); remote.current?.seek(time); }
    else if (video.current) { video.current.pause(); video.current.currentTime = time; }
    setCurrent(time); onSeek(time);
  }
  function toggle() {
    if (playing) { video.current?.pause(); remote.current?.pause(); return; }
    if (current >= slot.end - .05 || current < slot.start) seek(slot.start);
    if (isRemote) remote.current?.play();
    else void video.current?.play().catch((error: unknown) => {
      if (!enabled.current || (error instanceof DOMException && error.name === "AbortError")) return;
      onError(ui("재생 버튼을 다시 눌러 주세요."));
    });
  }
  function durationChanged(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (duration > RANKING_LIMITS.sourceSeconds) { onError(ui("3분 이하의 영상을 선택해 주세요.")); return; }
    if (source.durationKnown === false || source.duration !== duration) {
      const nextStart = Math.min(slot.start, Math.max(0, duration - .5));
      onChange({ source: { ...source, duration, durationKnown: true }, start: nextStart, end: Math.min(duration, Math.max(nextStart + .5, slot.end)) });
    }
  }
  return <>
    <RankingFramingEditor width={source.width} height={source.height}
      value={slot.framing} onChange={framing => onChange({ framing })}
      analysisUrl={url || undefined} start={slot.start} end={slot.end}
      playing={playing} ready={ready} time={current} onToggle={toggle}>
      {isRemote && source.remote?.platform === "youtube" ? <RankingRemotePlayer ref={remote} remote={source.remote}
        start={slot.start} label={ui(`${rank}위 원본 영상`)} suspended={suspended || !active} controlsHidden
        onReady={() => setReady(true)} onTime={time => { setCurrent(time); if (playing && time >= slot.end) remote.current?.pause(); }}
        onPlaying={value => { setPlaying(value); if (value && active) onStart(); }} onUnavailable={() => {}} onDuration={durationChanged} />
        : isRemote ? <div className="ranking-empty-source"><strong>{ui("저장한 영상의 미리보기를 다시 연결해 주세요")}</strong><button type="button" className="ranking-primary" disabled={suspended} onClick={onImport}>{ui("영상 가져오기")}</button></div>
        : <div className={`ranking-source-player${source.height > source.width && source.width > 0 ? " is-portrait" : ""}`}
          style={{ "--ranking-source-ratio": source.width > 0 && source.height > 0 ? source.width / source.height : 9 / 16 } as CSSProperties}>
          <video ref={video} src={url} controls={false} playsInline preload="metadata" aria-label={ui(`${rank}위 원본 영상`)}
            onLoadedMetadata={event => { event.currentTarget.currentTime = slot.start; setCurrent(slot.start); setReady(true); }}
            onTimeUpdate={event => { setCurrent(event.currentTarget.currentTime); if (event.currentTarget.currentTime >= slot.end) event.currentTarget.pause(); }}
            onPlay={() => { if (!active || suspended) { video.current?.pause(); return; } setPlaying(true); onStart(); }}
            onPause={() => setPlaying(false)} onError={() => { if (active) onError(ui("원본 영상을 불러오지 못했습니다. 다시 가져와 주세요.")); }} />
        </div>}
    </RankingFramingEditor>
    <div className="ranking-source-actions"><button type="button" className="ranking-source-remove" disabled={suspended}
      aria-label={ui(`${rank}위 영상 제거`)} title={ui("영상 제거")} onClick={() => onChange({ source: null, start: 0, end: 0 })}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button></div>
    {source.durationKnown === false ? <div className="ranking-prepare-preview">{slot.pendingLink ? null : suspended ? <p className="ranking-hint">{ui("영상 길이와 장면을 불러오고 있어요.")}</p> : <button type="button" onClick={onPrepare}>{ui("다시 시도")}</button>}</div>
      : <RankingTimeline src={url} duration={source.duration} start={slot.start} end={slot.end} current={current}
        disabled={suspended} onChange={(start, end) => onChange({ start, end })} onSeek={seek} />}
  </>;
}
