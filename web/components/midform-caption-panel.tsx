"use client";

import { emptyEntertainment, entertainmentStyles, type EntertainmentCaption, type EntertainmentCaptions } from "@/lib/midform-captions";
import styles from "./midform-workspace.module.css";

const clock = (n: number) => `${Math.floor(n / 60).toString().padStart(2, "0")}:${(n % 60).toFixed(1).padStart(4, "0")}`;

export function MidformCaptionPanel({ value, disabled, position, duration, onChange, onGenerate, onSeek }: {
  value?: EntertainmentCaptions; disabled: boolean; position: number; duration: number;
  onChange: (value: EntertainmentCaptions) => void; onGenerate: () => void; onSeek: (at: number) => void;
}) {
  const captions = value || emptyEntertainment;
  const addEnd = Math.min(position + 2, duration, ...captions.items.filter(c => c.enabled && c.start > position).map(c => c.start));
  const canAdd = addEnd - position >= .4 && !captions.items.some(c => c.enabled && c.start <= position && position < c.end);
  const patch = (id: string, change: Partial<EntertainmentCaption>) => onChange({ ...captions,
    items: captions.items.map(cue => cue.id === id ? { ...cue, ...change } : cue) });
  return <section className={styles.funPanel} aria-label="예능 자막 편집">
    <div className={styles.previewHeading}><h2>예능 자막 <span>대화의 반전을 짧게 강조해요</span></h2>
      <button type="button" className="ai-button" disabled={disabled} onClick={onGenerate}>
        {captions.items.length ? "AI 자막 다시 만들기" : "AI 예능 자막 만들기"}
      </button></div>
    <p className={styles.notice}>선택한 구간의 대본으로 자막을 만들고 영상에 적용합니다. 기본 위치는 중앙보다 살짝 아래예요. 얼굴이나 원래 자막과 겹치면 위치를 조절하세요.</p>
    {captions.mode === "basic" ? <p className={styles.notice} role="status">AI 자막을 만들지 못했습니다. 기존 예능 자막은 유지했습니다. 직접 추가하거나 다시 시도할 수 있어요.</p> : null}
    <div className={styles.actions}>
      <label className={styles.toggle}><input type="checkbox" checked={captions.enabled} disabled={disabled}
        onChange={e => onChange({ ...captions, enabled: e.target.checked })} />예능 자막 사용</label>
      <button type="button" className={styles.secondary} disabled={disabled || captions.items.length >= 40 || !canAdd}
        onClick={() => { const start = Math.min(position, duration - .4); onChange({ ...captions, enabled: true,
          items: [...captions.items, { id: crypto.randomUUID(), start, end: addEnd,
            text: "상황 자막", kicker: "", style: "comic", x: .5, y: .6, scale: 1, enabled: true }] }); }}>현재 위치에 직접 추가</button>
    </div>
    <div className={styles.funList}>{captions.items.map((cue, index) => <div key={cue.id} className={styles.funCard}>
      <div className={styles.previewHeading}><button type="button" className={styles.timestamp} onClick={() => onSeek(cue.start)}>{index + 1}. {clock(cue.start)}–{clock(cue.end)}</button>
        <label><input type="checkbox" checked={cue.enabled} disabled={disabled} onChange={e => patch(cue.id, { enabled: e.target.checked })} /> 표시</label>
        <button type="button" className={styles.secondary} disabled={disabled} onClick={() => onChange({ ...captions, items: captions.items.filter(c => c.id !== cue.id) })}>삭제</button></div>
      <label className={styles.label}>작은 윗말<input className={styles.input} aria-label={`자막 ${index + 1} 윗말`} value={cue.kicker} maxLength={16} disabled={disabled} onChange={e => patch(cue.id, { kicker: e.target.value })} /></label>
      <label className={styles.label}>강조할 문구<input className={styles.input} aria-label={`자막 ${index + 1} 문구`} value={cue.text} maxLength={24} disabled={disabled} onChange={e => patch(cue.id, { text: e.target.value })} /></label>
      <div className={styles.funFields}>
        <label>스타일<select className={styles.input} aria-label={`자막 ${index + 1} 스타일`} disabled={disabled} value={cue.style} onChange={e => patch(cue.id, { style: e.target.value as EntertainmentCaption["style"] })}>{Object.entries(entertainmentStyles).map(([key, style]) => <option value={key} key={key}>{style.label}</option>)}</select></label>
        <label>시작 (초)<input className={styles.input} type="number" aria-label={`자막 ${index + 1} 시작`} min={0} max={duration} step={.1} value={cue.start} disabled={disabled} onChange={e => patch(cue.id, { start: Number(e.target.value) })} /></label>
        <label>끝 (초)<input className={styles.input} type="number" aria-label={`자막 ${index + 1} 끝`} min={0} max={duration} step={.1} value={cue.end} disabled={disabled} onChange={e => patch(cue.id, { end: Number(e.target.value) })} /></label>
        <label>크기 {Math.round(cue.scale * 100)}%<input type="range" aria-label={`자막 ${index + 1} 크기`} min={65} max={125} step={5} value={Math.round(cue.scale * 100)} disabled={disabled} onChange={e => patch(cue.id, { scale: Number(e.target.value) / 100 })} /></label>
        <label>좌우 위치<input type="range" aria-label={`자막 ${index + 1} 좌우 위치`} min={15} max={85} step={1} value={Math.round(cue.x * 100)} disabled={disabled} onChange={e => patch(cue.id, { x: Number(e.target.value) / 100 })} /></label>
        <label>높이 · 위에서 {Math.round(cue.y * 100)}%<input type="range" aria-label={`자막 ${index + 1} 높이`} min={20} max={75} step={1} value={Math.round(cue.y * 100)} disabled={disabled} onChange={e => patch(cue.id, { y: Number(e.target.value) / 100 })} /></label>
      </div>
    </div>)}</div>
  </section>;
}

export function MidformCaptionPreview({ cue }: { cue?: EntertainmentCaption }) {
  if (!cue) return null;
  const design = entertainmentStyles[cue.style];
  const size = Math.min(design.size * cue.scale, 940 / Math.max(1, [...cue.text].length));
  const half = Math.min(.45, Math.max([...cue.text].length * size / 2 / 1280, cue.kicker.length * 17 / 1280) + .02);
  const x = Math.min(1 - half, Math.max(half, cue.x));
  return <div aria-label="예능 자막 미리보기" className={`${styles.funOverlay} ${["label", "challenge"].includes(cue.style) ? styles.funBox : ""}`}
    style={{ left: `${x * 100}%`, top: `${cue.y * 100}%`, color: design.color,
      fontFamily: `"${design.font}", sans-serif`, fontSize: `${size / 12.8}cqw`,
      transform: `translate(-50%, -50%) rotate(${-design.angle}deg)` }}>
    {cue.kicker ? <span>{cue.kicker}</span> : null}<strong>{cue.text}</strong>
  </div>;
}
