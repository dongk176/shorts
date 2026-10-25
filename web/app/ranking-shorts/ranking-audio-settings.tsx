"use client";
import { useEffect, useRef, useState } from "react";
import { rankingSounds, type RankingSound } from "@/lib/ranking-audio";
import { useRankingBackdrop } from "./use-ranking-backdrop";
import { RankingSelect } from "./ranking-select";

export function RankingAudioSettings({ sound, enabled, onSound, onEnabled, music, musicEnabled,
  onMusicEnabled, onUpload, onRemove, volume, onVolume, disabled, project, localUrl, presentation = "inline" }: {
  sound: RankingSound; enabled: boolean; onSound: (sound: RankingSound) => void;
  onEnabled: (enabled: boolean) => void; music: {id: string; name: string} | null;
  musicEnabled: boolean; onMusicEnabled: (enabled: boolean) => void;
  onUpload: (file: File) => void; onRemove: () => void; volume: number;
  onVolume: (volume: number) => void; disabled: boolean; project: string | null; localUrl?: string; presentation?: "inline" | "dialog";
}) {
  const sample = useRef<HTMLAudioElement>(null);
  const [open, setOpen] = useState(false);
  const backdrop = useRankingBackdrop(() => setOpen(false));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const focus = document.activeElement as HTMLElement | null;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element?.querySelectorAll("audio").forEach(audio => audio.pause()); element?.close(); document.body.style.overflow = previous; focus?.focus({preventScroll:true}); };
  }, [open]);
  const settings = <details className="ranking-audio-settings" open={presentation === "dialog" ? true : undefined}>
    <summary>소리 <span>{enabled ? "효과음 켜짐" : "효과음 없음"}{music && musicEnabled ? " · 배경음악 켜짐" : ""}</span></summary>
    <div className="ranking-audio-row">
      <span>전환 효과음</span>
      <button type="button" role="switch" aria-label="전환 효과음" aria-checked={enabled}
        disabled={disabled} onClick={() => {sample.current?.pause(); onEnabled(!enabled);}}>{enabled ? "켜짐" : "꺼짐"}</button>
      {enabled && <>
        <RankingSelect label="전환 효과음 선택" value={sound} disabled={disabled}
          options={rankingSounds.map((item) => ({value: item.id, label: item.label}))}
          onChange={(value) => {sample.current?.pause(); onSound(value as RankingSound);}} />
        <button type="button" aria-label="효과음 들어보기" onClick={() => {
          if (sample.current) {sample.current.currentTime = 0; void sample.current.play().catch(() => {});}
        }}>▶ 듣기</button>
        <audio ref={sample} src={`/audio/ranking/${rankingSounds.find(item => item.id === sound)?.asset}.mp4`} preload="none" />
      </>}
    </div>
    {enabled && <p className="ranking-hint">순위 사이에 같은 소리와 검정 화면이 들어갑니다.</p>}
    <div className="ranking-audio-row">
      <span>배경음악</span>
      <button type="button" role="switch" aria-label="배경음악" aria-checked={musicEnabled}
        disabled={disabled} onClick={() => onMusicEnabled(!musicEnabled)}>{musicEnabled ? "켜짐" : "꺼짐"}</button>
      {musicEnabled && <label className="ranking-audio-upload">{music ? "음악 변경" : "음악 파일 선택"}
        <input type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.flac" disabled={disabled}
          onChange={(event) => {const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file);}} />
      </label>}
      {music && <button type="button" disabled={disabled} onClick={onRemove}>삭제</button>}
    </div>
    {musicEnabled && music ? <div className="ranking-music-controls">
      <span>{music.name}</span>
      <p className="ranking-hint">영상 끝까지 재생합니다. 짧은 음악은 반복됩니다.</p>
      <label>볼륨 {Math.round(volume * 100)}%<input aria-label="배경음악 볼륨" type="range" min="0" max="100" value={Math.round(volume * 100)}
        disabled={disabled} onChange={(event) => onVolume(Number(event.target.value) / 100)} /></label>
      <audio controls preload="none" src={localUrl || `/api/ranking-shorts/${project}/media/${music.id}`} aria-label="배경음악 들어보기"
        ref={(element) => {if (element) element.volume = volume;}} />
    </div> : musicEnabled ? <p className="ranking-hint">MP3·WAV·M4A 등 · 최대 30MB / 20분</p> : null}
  </details>;
  if (presentation === "inline") return settings;
  return <><button type="button" className="ranking-sound-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden="true">♫</span> 소리 설정 <small>{enabled || musicEnabled ? "ON" : "OFF"}</small></button>
    {open && <dialog className="ranking-local-sound-dialog" ref={dialog} aria-labelledby="ranking-sound-heading" onCancel={() => setOpen(false)} {...backdrop}>
      <header><div><h2 id="ranking-sound-heading">소리 설정</h2><p>순위 사이의 효과음과 배경음악</p></div><button type="button" aria-label="소리 설정 닫기" onClick={() => setOpen(false)}>×</button></header>
      {settings}<button type="button" className="ranking-sound-done" onClick={() => setOpen(false)}>완료</button>
    </dialog>}
  </>;
}
