"use client";
import { useUiText } from "@/lib/i18n/use-ui-text";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { rankingDesign, type RankingStyle } from "@/lib/ranking-templates";
import { rankingTime, type RankingSource } from "@/lib/ranking-shorts";
import { RankingThumbnail } from "@/components/ranking-thumbnail";
import {
  rankingPlaybackPosition,
  type RankingPlaybackClip,
} from "@/lib/ranking-playback";
import type { RankingFraming } from "@/lib/ranking-framing";
import { RankingFramedMedia } from "./ranking-framed-media";
import { RankingOverlay } from "./ranking-overlay";

export function RankingSequencePreview({
  clips,
  localMedia = {},
  backgroundMusic,
  project,
  title,
  subtitle,
  count,
  labels,
  descending,
  style,
  suspended,
  pauseSignal,
  onStart,
  layoutOnly = false,
  previewSource,
  previewSources,
  previewStart = 0,
  previewRank = 1,
  framedSources,
  controlsBelow = false,
  resetKey,
}: {
  resetKey?: string;
  framedSources?: Record<string, {width:number;height:number;framing?:RankingFraming}>;
  controlsBelow?: boolean;
  clips: RankingPlaybackClip[];
  localMedia?: Record<string,string>;
  backgroundMusic?: {sourceId: string; volume: number} | null;
  project: string | null;
  title: string;
  subtitle: string;
  count: number;
  labels: string[];
  descending: boolean;
  style: RankingStyle;
  layoutOnly?: boolean;
  previewSource?: RankingSource;
  previewSources?: RankingSource[];
  previewStart?: number;
  previewRank?: number;
  suspended: boolean;
  pauseSignal: number;
  onStart: () => void;
}) {
  const ui = useUiText();
  const video = useRef<HTMLVideoElement>(null);
  const music = useRef<HTMLAudioElement>(null);
  const mediaElements = useRef(new Map<number, HTMLVideoElement>());
  const intent = useRef(false);
  const transitioning = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const clip = clips[index];
  const total = clips.reduce((sum, item) => sum + item.end - item.start, 0);
  const offset = clips
    .slice(0, index)
    .reduce((sum, item) => sum + item.end - item.start, 0);
  useEffect(() => {
    intent.current = false;
    video.current?.pause();
  }, [pauseSignal]);
  useEffect(() => {
    if (suspended) {
      intent.current = false;
      video.current?.pause();
    }
  }, [suspended]);

  const advance = useCallback(() => {
    if (transitioning.current || !intent.current) return;
    transitioning.current = true;
    const media = video.current;
    media?.pause();
    setPlaying(false);
    if (index + 1 < clips.length) {
      pendingSeek.current = clips[index + 1].start;
      setIndex(index + 1);
    } else {
      intent.current = false;
      if (media) media.currentTime = clips[index].end;
      setElapsed(total);
      transitioning.current = false;
    }
  }, [clips, index, total]);

  // Check the cut boundary every animation frame, rather than relying on sparse timeupdate events.
  useEffect(() => {
    if (!playing || !clip) return;
    let frame = 0;
    const tick = () => {
      const media = video.current;
      if (!media || !intent.current) return;
      if (transitioning.current) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const sourceTime = Math.min(
        clip.end,
        Math.max(clip.start, media.currentTime),
      );
      setElapsed(offset + sourceTime - clip.start);
      if (media.currentTime >= clip.end - 0.015 || media.ended) {
        advance();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, clip, offset, advance]);

  function syncMusic() {
    const audio = music.current;
    if (!audio || !backgroundMusic || !Number.isFinite(audio.duration) || !audio.duration) return;
    audio.volume = backgroundMusic.volume * Math.min(1, Math.max(0, total - elapsed) / 0.3);
    const position = (offset + Math.max(0, (video.current?.currentTime ?? clip.start) - clip.start)) % audio.duration;
    if (Math.abs(audio.currentTime - position) > 0.2) audio.currentTime = position;
    if (intent.current) void audio.play().catch((cause: unknown) => {
      // A clip change or pause can cancel an outstanding play request normally.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (intent.current) setError(ui("배경음악 재생 버튼을 다시 눌러 주세요."));
    });
  }
  function play(media: HTMLVideoElement) {
    void media.play().catch((cause: unknown) => {
      // Editing can pause a pending play() without a playback failure.
      if ((cause instanceof DOMException && cause.name === "AbortError") || !intent.current || video.current !== media) return;
      intent.current = false;
      setPlaying(false);
      setError(ui("재생 버튼을 다시 눌러 주세요."));
    });
  }
  function seek(seconds: number) {
    const next = rankingPlaybackPosition(clips, seconds);
    if (!next) return;
    intent.current = false;
    transitioning.current = false;
    video.current?.pause();
    setElapsed(Math.min(total, Math.max(0, seconds)));
    // Keep the latest seek while a newly selected source is still loading.
    pendingSeek.current = next.time;
    if (index !== next.index) setIndex(next.index);
    else if (video.current && video.current.readyState >= 1) {
      video.current.currentTime = next.time;
      pendingSeek.current = null;
    }
  }
  function toggle() {
    if (!clip || suspended) return;
    if (intent.current) {
      intent.current = false;
      video.current?.pause();
      return;
    }
    onStart();
    setError("");
    intent.current = true;
    if (elapsed >= total - 0.02) {
      setElapsed(0);
      pendingSeek.current = clips[0].start;
      if (index !== 0) {
        setIndex(0);
        return;
      }
      if (video.current) video.current.currentTime = clips[0].start;
    }
    if (video.current) play(video.current);
  }
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,textarea,select,button,a,video,audio,[contenteditable="true"],[role="slider"],[role="textbox"]') || document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]')) return;
      if (!clip || suspended || layoutOnly) return;
      event.preventDefault(); toggleRef.current();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [clip, suspended, layoutOnly]);
  const clipStart = clip?.start;
  useEffect(() => {
    const media = mediaElements.current.get(index);
    if (!media || clipStart === undefined) return;
    video.current = media;
    if (media.readyState >= 1) {
      media.currentTime = pendingSeek.current ?? clipStart;
      pendingSeek.current = null;
      transitioning.current = false;
      if (intent.current) void media.play().catch((cause: unknown) => {
        if ((cause instanceof DOMException && cause.name === "AbortError") || !intent.current || video.current !== media) return;
        intent.current = false; setPlaying(false); setError(ui("재생 버튼을 다시 눌러 주세요."));
      });
    }
  }, [index, clipStart, ui]);
  const framed = Boolean(framedSources);
  const selectedSourceId = previewSource?.id;
  const firstClipStart = clips[0]?.start;
  useEffect(() => {
    // Reset the transport without replacing video elements and their buffered bytes.
    // The studio changes resetKey while trimming, reordering or changing music.
    if (!framed && resetKey === undefined) return;
    intent.current = false; transitioning.current = false;
    mediaElements.current.forEach(media => media.pause());
    music.current?.pause();
    setError("");
    setPlaying(false); setElapsed(0); setIndex(0);
    const first = mediaElements.current.get(0);
    pendingSeek.current = firstClipStart ?? null;
    if (first && first.readyState >= 1 && firstClipStart !== undefined) {
      first.currentTime = firstClipStart; video.current = first; pendingSeek.current = null;
    }
  }, [framed, selectedSourceId, previewStart, previewRank, firstClipStart, resetKey]);
  const videoStyle = {
    "--ranking-video-top": `${(rankingDesign.layout.headerHeight / rankingDesign.layout.height) * 100}%`,
  } as CSSProperties;
  const playButton = (<button type="button" className="ranking-preview-toggle" disabled={!clip || suspended}
          aria-label={playing ? ui("전체 미리보기 일시 정지") : ui("전체 미리보기 재생")} aria-keyshortcuts="Space" onClick={toggle}>
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">{playing ? <path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor" /> : <path d="m9 5 11 7-11 7z" fill="currentColor" />}</svg>
        </button>);
  return (
    <div className="ranking-sequence-preview">
      {backgroundMusic && (project || localMedia[backgroundMusic.sourceId]) && !layoutOnly ? <audio ref={music} loop preload="auto"
        src={localMedia[backgroundMusic.sourceId] || `/api/ranking-shorts/${project}/media/${backgroundMusic.sourceId}?purpose=sequence_preview`}
        onLoadedMetadata={syncMusic} onError={() => setError(ui("배경음악 미리보기가 만료되었습니다. 음악을 다시 추가해 주세요."))} /> : null}
      <div data-i18n-content className={`ranking-composition${clip?.transitionUrl ? " is-transition" : ""}`} style={videoStyle}>
        {clips.length > 0 && !layoutOnly ? clips.map((item, itemIndex) => {
          const media = (<video
            key={`${item.sourceId}:${item.rank}`}
            ref={element => { if (element) { mediaElements.current.set(itemIndex, element); if (itemIndex === index) video.current = element; } else mediaElements.current.delete(itemIndex); }}
            className={itemIndex === index ? "is-current" : "is-buffered"}
            aria-hidden={itemIndex !== index}
            playsInline
            preload={itemIndex >= index && itemIndex <= index + 2 ? "auto" : "none"}
            src={item.transitionUrl || localMedia[item.sourceId] || `/api/ranking-shorts/${project}/media/${item.sourceId}?purpose=sequence_preview`}
            aria-label={ui("전체 미리보기 영상")}
            data-rank={item.rank}
            onLoadedMetadata={(event) => {
              const media = event.currentTarget;
              media.currentTime = itemIndex === index ? pendingSeek.current ?? item.start : item.start;
              if (itemIndex !== index) return;
              pendingSeek.current = null;
              transitioning.current = false;
              if (intent.current) play(media);
            }}
            onPlaying={() => { if (itemIndex === index) {setPlaying(true); syncMusic();} }}
            onTimeUpdate={() => { if (itemIndex === index) syncMusic(); }}
            onPause={() => { if (itemIndex === index) {setPlaying(false); music.current?.pause();} }}
            onEnded={() => { if (itemIndex === index) advance(); }}
            onError={() => {
              if (itemIndex !== index) return;
              music.current?.pause(); intent.current = false; setPlaying(false);
              setError(ui("미리보기를 불러오지 못했습니다. 영상을 다시 가져와 주세요."));
            }}
          />);
          if (!framedSources) return media;
          const geometry = framedSources[item.sourceId];
          return <div key={`${item.sourceId}:${item.rank}`} className={`ranking-sequence-scene${itemIndex !== index ? " is-buffered" : ""}${item.transitionUrl ? " is-transition" : ""}`}>
            {item.transitionUrl ? media : <RankingFramedMedia width={geometry?.width || 0} height={geometry?.height || 0} framing={geometry?.framing}>{media}</RankingFramedMedia>}
          </div>;
        }) : <div className="ranking-composition-empty" />}
        {(previewSources || (previewSource ? [previewSource] : [])).map(source => <RetainedStill
          key={source.id} source={source} framedSources={framedSources}
          active={!clip?.transitionUrl && source.id === previewSource?.id && (layoutOnly || (!playing && elapsed === 0))}
          time={source.id === previewSource?.id ? previewStart : clips.find(item => item.sourceId === source.id)?.start || 0}
          videoUrl={localMedia[source.id] || (project && (!source.remote || source.previewReady) ? `/api/ranking-shorts/${project}/media/${source.id}?purpose=thumbnail` : undefined)}
        />)}
        {!clip?.transitionUrl && <RankingOverlay
          title={title}
          subtitle={subtitle}
          count={count}
          active={layoutOnly || (!playing && elapsed === 0) ? previewRank - 1 : clip ? clip.rank - 1 : 0}
          labels={labels}
          descending={descending}
          revealedRanks={
            layoutOnly || (!playing && elapsed === 0)
              ? Array.from({ length: count }, (_, i) => i + 1)
              : clips.slice(0, index + 1).map((item) => item.rank)
          }
          style={style}
        />}
        {!layoutOnly && !controlsBelow && playButton}
      </div>
      {!layoutOnly && controlsBelow && <div className="ranking-preview-transport">{playButton}</div>}

      {layoutOnly ? (
        <p className="ranking-hint">
          {previewSource?.remote?.platform === "youtube" && !previewSource.previewReady
            ? ui("유튜브 표지 미리보기예요. 선택한 장면은 원본 플레이어에서 확인하세요.")
            : ui("선택한 영상의 표지와 배치를 보여드려요. 전체 영상은 제작 후 재생할 수 있습니다.")}
        </p>
      ) : (
        <div className="ranking-sequence-controls">
          <span>
            {rankingTime(elapsed)} / {rankingTime(total)}
          </span>
        </div>
      )}
      {!layoutOnly ? (
        <input
          className="ranking-sequence-scrubber"
          aria-label={ui("전체 미리보기 위치")}
          type="range"
          min="0"
          max={total || 1}
          step="0.01"
          value={elapsed}
          disabled={!clip || suspended}
          onChange={(event) => seek(Number(event.target.value))}
        />
      ) : null}
      {error ? (
        <p role="alert" className="ranking-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Keep the selected-frame video buffered when another rank or playback is shown.
function RetainedStill({ source, active, time, videoUrl, framedSources }: {
  source: RankingSource; active: boolean; time: number; videoUrl?: string;
  framedSources?: Record<string, {width:number;height:number;framing?:RankingFraming}>;
}) {
  const [visited, setVisited] = useState(false);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  const thumbnail = visited || active ? <RankingThumbnail lazy={false} portrait remote={source.remote} time={time} videoUrl={videoUrl} /> : null;
  return <div className={framedSources ? "ranking-sequence-still" : "ranking-composition-still"} style={{display: active ? undefined : "none"}}>
    {framedSources ? <RankingFramedMedia width={source.width} height={source.height} framing={framedSources[source.id]?.framing}>{thumbnail}</RankingFramedMedia> : thumbnail}
  </div>;
}
