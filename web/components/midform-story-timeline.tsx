"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { EditorTimelineRuler } from "./editor-timeline-ruler";
import { attachTimelineZoomGestures, type TimelineZoomAnchor } from "@/lib/editor-timeline-gestures";
import { midformRanges, type MidformDraft, type MidformRow, type MidformSourceScene } from "@/lib/midform-local";
import { deleteMidformStory, midformCaptionCues, midformStories, resizeMidformStory, splitMidformStory, storyBounds, storyRows, type MidformStory } from "@/lib/midform-story-edit";
import { speakerAppearance, speakerKeys } from "@/lib/midform-speakers";
import { timelineThumbnailCount } from "@/lib/use-timeline-thumbnails";
import styles from "./midform-story-timeline.module.css";

const clock = (n: number) => `${Math.floor(n / 60).toString().padStart(2,"0")}:${Math.floor(n % 60).toString().padStart(2,"0")}`;
type Props = { draft: MidformDraft; sourceRows: MidformRow[]; sourceScenes?: MidformSourceScene[]; silences: number[][]; sourceDuration: number; position: number;
  thumbnails: string[]; zoom: number; onZoomChange: (zoom: number) => void; busy: boolean; onChange: (draft: MidformDraft) => void;
  onSeek: (seconds: number) => void; onReview: (seconds: number) => void; onCaptionSelect: () => void };

export function MidformStoryTimeline(props: Props) {
  const { draft, onChange, onZoomChange } = props;
  const scrollArea = useRef<HTMLDivElement>(null);
  const tracks = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(props.zoom);
  const zoomAnchor = useRef<TimelineZoomAnchor | null>(null);
  const view = useRef<{ zoom: number; scrollLeft: number; trackWidth: number; trackLeft: number } | null>(null);
  const rememberView = useCallback(() => {
    const area = scrollArea.current, track = tracks.current;
    if (area && track) view.current = { zoom: zoomRef.current, scrollLeft: area.scrollLeft, trackWidth: track.clientWidth,
      trackLeft: track.getBoundingClientRect().left - area.getBoundingClientRect().left + area.scrollLeft };
  }, []);
  useEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    return attachTimelineZoomGestures(area, {
      getZoom: () => zoomRef.current, min: 1, max: 8,
      onZoom: (value, point) => {
        const track = tracks.current;
        if (!track || value === zoomRef.current) return;
        // The label gutter stays the same width at every zoom level.
        const left = track.getBoundingClientRect().left - area.getBoundingClientRect().left + area.scrollLeft;
        zoomAnchor.current = { viewportX: point.viewportX, ratio: (area.scrollLeft + point.viewportX - left) / track.clientWidth };
        zoomRef.current = value;
        onZoomChange(value);
      },
    });
  }, [onZoomChange]);
  useLayoutEffect(() => {
    const area = scrollArea.current, track = tracks.current, previous = view.current;
    // Zoom buttons keep the middle of the current view; pinches keep the finger position.
    const point = zoomAnchor.current || (area && previous && previous.zoom !== props.zoom ? {
      viewportX: area.clientWidth / 2,
      ratio: (previous.scrollLeft + area.clientWidth / 2 - previous.trackLeft) / previous.trackWidth,
    } : null);
    zoomRef.current = props.zoom;
    if (area && track && point) {
      const left = track.getBoundingClientRect().left - area.getBoundingClientRect().left + area.scrollLeft;
      area.scrollLeft = left + point.ratio * track.clientWidth - point.viewportX;
      zoomAnchor.current = null;
    }
    rememberView();
  }, [props.zoom, rememberView]);
  useEffect(() => {
    const track = tracks.current;
    if (!track) return;
    const observer = new ResizeObserver(rememberView);
    observer.observe(track);
    return () => observer.disconnect();
  }, [rememberView]);
  const stories = useMemo(() => midformStories(props.sourceRows, props.sourceDuration, draft.sceneSplits, props.sourceScenes), [props.sourceRows, props.sourceDuration, draft.sceneSplits, props.sourceScenes]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedCaption, setSelectedCaption] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [dragDraft, setDragDraft] = useState<MidformDraft | null>(null);
  const drag = useRef<{ pointerId: number; startX: number; story: MidformStory; edge: "start" | "end"; draft: MidformDraft; seconds: number; ratio: number; next: MidformDraft } | null>(null);
  const currentDraft = dragDraft || draft;
  const parts = useMemo(() => midformRanges(currentDraft.rows, props.silences, true), [currentDraft.rows, props.silences]);
  const captions = useMemo(() => midformCaptionCues(currentDraft.rows, props.silences), [currentDraft.rows, props.silences]);
  const keys = useMemo(() => speakerKeys(draft), [draft]);
  const captionLanes = useMemo(() => keys.flatMap(key => {
    const cues = captions.filter(cue => cue.speaker === key);
    return cues.length ? [{ key, cues, name: draft.names[key] || (key === "unknown" ? "미확인" : key === "overlap" ? "겹친 음성" : `화자 ${speakerAppearance(key, keys).badge}`), ...speakerAppearance(key, keys) }] : [];
  }), [captions, keys, draft.names]);
  const scenes = useMemo(() => {
    let elapsed = 0;
    return stories.map(story => {
      const bounds = storyBounds(currentDraft.rows, story);
      const pieces = parts.flatMap(part => {
        const start = Math.max(part.start, story.availableStart), end = Math.min(part.end, story.availableEnd);
        return end > start ? [{ ...part, start, end }] : [];
      });
      const duration = pieces.reduce((sum, part) => sum + part.end - part.start, 0);
      const outputStart = elapsed; elapsed += duration;
      return { ...story, ...bounds, pieces, duration, outputStart, outputEnd: elapsed };
    }).filter(story => story.duration > .08);
  }, [stories, currentDraft.rows, parts]);
  const total = scenes.at(-1)?.outputEnd || 0;
  const playingScene = scenes.find(story => story.pieces.some(piece => props.position >= piece.start && props.position < piece.end));
  const active = scenes.find(story => story.id === selected) || playingScene;
  let elapsed = 0;
  for (const part of parts) { if (props.position >= part.end) elapsed += part.end - part.start; else { elapsed += Math.max(0, props.position - part.start); break; } }
  const sourceAtOutput = (seconds: number) => {
    let remaining = seconds;
    for (const part of parts) { const length = part.end - part.start; if (remaining < length) return part.start + Math.max(0, remaining); remaining -= length; }
    return (parts.at(-1)?.end || 0) - .01;
  };
  const splitCandidate = playingScene ? splitMidformStory(draft, playingScene, props.position) : draft;
  const split = () => {
    if (!playingScene || splitCandidate === draft || props.busy) return;
    const cut = splitCandidate.sceneSplits?.find(value => !draft.sceneSplits?.includes(value));
    const nextStories = midformStories(props.sourceRows, props.sourceDuration, splitCandidate.sceneSplits, props.sourceScenes);
    const right = nextStories.find(story => story.availableStart === cut);
    onChange(splitCandidate); setSelected(right?.id || null); setSelectedCaption(null);
  };
  const remove = () => {
    if (props.busy) return;
    const next = selectedCaption
      ? { ...draft, rows: draft.rows.map(row => row.id === selectedCaption ? { ...row, keep: false } : row) }
      : active ? deleteMidformStory(draft, active) : draft;
    if (next === draft || !next.rows.some(row => row.keep)) return;
    onChange(next); setSelected(null); setSelectedCaption(null);
    props.onSeek(midformRanges(next.rows, props.silences, true)[0]?.start || 0);
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>, story: typeof active, edge: "start" | "end") => {
    if (!story || props.busy || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const width = event.currentTarget.closest<HTMLElement>("[data-story-track]")?.clientWidth || 1;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, story, edge, draft, seconds: story[edge], ratio: total / width, next: draft };
    setSelected(story.id); setSelectedCaption(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    state.next = resizeMidformStory(state.draft, state.story, state.edge, state.seconds + (event.clientX - state.startX) * state.ratio);
    setDragDraft(state.next);
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null; setDragDraft(null);
    if (!cancel && state.next !== state.draft) { onChange(state.next); props.onSeek(storyBounds(state.next.rows, state.story)[state.edge] + (state.edge === "end" ? -.01 : .01)); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const step = (story: MidformStory, edge: "start" | "end", direction: -1 | 1) => {
    const bounds = storyBounds(draft.rows, story), rows = storyRows(draft.rows, story);
    const index = rows.reduce((best, row, index) => Math.abs(row[edge] - bounds[edge]) < Math.abs(rows[best][edge] - bounds[edge]) ? index : best, 0);
    const row = rows[Math.max(0, Math.min(rows.length - 1, index + direction))];
    if (!row) return;
    const next = resizeMidformStory(draft, story, edge, row[edge]);
    onChange(next); props.onSeek(storyBounds(next.rows, story)[edge] + (edge === "end" ? -.01 : .01));
  };

  return <div className={styles.timeline} onKeyDown={event => {
    if ((event.key === "Delete" || event.key === "Backspace") && !(event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) { event.preventDefault(); event.stopPropagation(); remove(); }
  }}>
    <div className={styles.controls}>
      <button type="button" disabled={props.busy || splitCandidate === draft} title="재생 위치의 대사 경계에서 분할" onClick={split}><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="5" cy="15" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="m7 6 9 10M7 14l9-10" stroke="currentColor" strokeWidth="1.5"/></svg>분할</button>
      <button type="button" disabled={props.busy || (!selectedCaption && (!active || scenes.length < 2))} title="선택한 영상 또는 자막 구간 삭제" onClick={remove}>삭제</button>
      <span className={styles.divider} />
      <button type="button" aria-pressed={showSource} onClick={() => setShowSource(!showSource)}>원본 구간 {showSource ? "접기" : "보기"}</button>
      <span className={styles.count}>{scenes.length}개 장면 · 무음 자동 정리</span>
    </div>
    <div className={styles.scrollFrame}><div ref={scrollArea} onScroll={rememberView} className={`editor-timeline-scroll-area ${styles.scrollArea}`}><div className={styles.content} style={{ width: `${props.zoom * 100}%` }}>
      <div className={styles.ruler}><EditorTimelineRuler start={0} duration={total} /><input data-editor-seek type="range" aria-label="타임라인 재생 위치" min={0} max={total || 1} step={.05} value={Math.min(total,elapsed)} onChange={event => props.onSeek(sourceAtOutput(Number(event.target.value)))} /></div>
      <div ref={tracks} className={styles.tracks}>
        <div className={styles.track} data-story-track><span className={styles.label}>영상</span>{scenes.map((story,index) => {
          const thumbnail = props.thumbnails[Math.min(timelineThumbnailCount - 1, Math.floor(story.start / (props.sourceDuration || 1) * timelineThumbnailCount))];
          return <div key={story.id} className={`${styles.scene}${active?.id === story.id && !selectedCaption ? ` ${styles.selected}` : ""}`} style={{ left: `${story.outputStart / (total || 1) * 100}%`, width: `calc(${story.duration / (total || 1) * 100}% - 3px)` }}>
            <button className={styles.sceneBody} data-editor-seek type="button" aria-label={`장면 ${index + 1} 선택`} title={`원본 ${clock(story.start)} — ${clock(story.end)}`} style={thumbnail ? { backgroundImage: `url(${thumbnail})` } : undefined} onClick={event => {
              setSelected(story.id); setSelectedCaption(null);
              const rect=event.currentTarget.getBoundingClientRect();
              const offset=event.detail ? Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*story.duration : 0;
              props.onSeek(sourceAtOutput(story.outputStart+offset));
            }}><span>장면 {index + 1}</span><time>{clock(story.duration)}</time></button>
            {(["start", "end"] as const).map(edge => <button type="button" key={edge} className={`${styles.handle} ${edge === "start" ? styles.left : styles.right}`} role="slider" tabIndex={active?.id === story.id ? 0 : -1} aria-label={`장면 ${index + 1} ${edge === "start" ? "앞부분" : "뒷부분"} 조절`} aria-valuemin={story.availableStart} aria-valuemax={story.availableEnd} aria-valuenow={story[edge]} aria-valuetext={clock(story[edge])} title={`원본 ${clock(story[edge])}`} disabled={props.busy} onPointerDown={event => startDrag(event, story, edge)} onPointerMove={moveDrag} onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)} onLostPointerCapture={() => { drag.current = null; setDragDraft(null); }} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); step(story,edge,event.key === "ArrowLeft" ? -1 : 1); } }}>Ⅱ{dragDraft && drag.current?.story.id === story.id && drag.current.edge === edge ? <span className={styles.trimTime}>원본 {clock(story[edge])}</span> : null}</button>)}
          </div>;
        })}</div>
        <div className={styles.captionTracks} role="group" aria-label="화자별 자막 타임라인">{captionLanes.map(lane => <div key={lane.key} className={styles.captionTrack} role="group" aria-label={`${lane.name} 자막 타임라인`} data-caption-speaker={lane.key}>
          <span className={styles.label} title={lane.name}><span className={styles.speakerBadge} style={{ color: lane.color, borderColor: `${lane.color}66`, backgroundColor: `${lane.color}20` }}>{lane.badge}</span><span className={styles.speakerName}>{lane.name}</span></span>
          {lane.cues.map(cue => <button type="button" data-editor-seek key={cue.id} className={selectedCaption===cue.id?styles.captionSelected:undefined} title={cue.text} aria-label={`${lane.name} 자막: ${cue.text}`} aria-pressed={selectedCaption===cue.id} style={{left:`${cue.start/(total||1)*100}%`,width:`${(cue.end-cue.start)/(total||1)*100}%`,borderColor:`${lane.color}88`,backgroundColor:`${lane.color}22`}} onClick={()=>{setSelectedCaption(cue.id);props.onSeek(cue.sourceStart+.01);props.onCaptionSelect();}}><span className={styles.captionText}>{cue.text}</span></button>)}
        </div>)}</div>
        <div className={styles.playhead} style={{ left: `${Math.min(1, elapsed / (total || 1)) * 100}%` }}><i /></div>
      </div>
      {showSource ? <div className={styles.sourceTrack}><span className={styles.label}>원본</span>{scenes.map(story => <span key={story.id} style={{ left: `${story.start / (props.sourceDuration || 1) * 100}%`, width: `${(story.end - story.start) / (props.sourceDuration || 1) * 100}%` }} />)}<input type="range" aria-label="원본 재생 위치" min={0} max={props.sourceDuration || 1} step={.1} value={props.position} onChange={event => props.onReview(Number(event.target.value))} /></div> : null}
    </div></div><div className={styles.gutterMask} aria-hidden="true" /></div>
    {dragDraft ? <p className={styles.hint}>놓으면 앞뒤 구간이 반영돼요.</p> : null}
  </div>;
}
