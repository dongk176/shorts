"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUiText } from "@/lib/i18n/use-ui-text";
import styles from "./silence-removal-choice.module.css";

const waveform = [10, 20, 34, 16, 42, 54, 28, 44, 20, 36, 58, 46, 24, 40, 18, 30, 48, 22];

function SpeechWave({ variant = 0 }: { variant?: number }) {
  return <span className={styles.speech}>{waveform.map((height, index) =>
    <i key={index} style={{ height: `${waveform[(index + variant) % waveform.length] || height}px` }} />,
  )}</span>;
}

function WaveformAnimation() {
  const ui = useUiText();
  return <div className={styles.demonstration} role="img" aria-label={ui("음성 파형 사이의 평평한 무음 두 구간을 잘라내고, 남은 대화 파형 세 구간을 이어 붙이는 예시")}>
    <div className={styles.trackHeading}><span>{ui("원본 쇼츠")}</span><span className={styles.beforeHint}>{ui("말 사이에 긴 쉼")}</span></div>
    <div className={styles.track} aria-hidden="true">
      <SpeechWave /><span className={styles.gap}><span>{ui("무음")}</span><i /></span>
      <SpeechWave variant={5} /><span className={`${styles.gap} ${styles.smallGap}`}><span>{ui("무음")}</span><i /></span>
      <SpeechWave variant={9} />
    </div>
    <div className={styles.cutDirection} aria-hidden="true"><span>✂</span><i /></div>
    <div className={styles.trackHeading}><span className={styles.afterHeading}>{ui("무음 삭제 후")}</span><span className={styles.afterHint}>{ui("대화가 바로 이어져요")}</span></div>
    <div className={`${styles.track} ${styles.trimmed}`} aria-hidden="true">
      <SpeechWave /><span className={styles.gap}><span className={styles.cutPiece}><b>{ui("무음")}</b><i /></span></span>
      <SpeechWave variant={5} /><span className={`${styles.gap} ${styles.smallGap}`}><span className={styles.cutPiece}><b>{ui("무음")}</b><i /></span></span>
      <SpeechWave variant={9} /><span className={styles.playhead} />
    </div>
    <div className={styles.legend}><span><i />{ui("대화 유지")}</span><span><i />{ui("무음 잘라내기")}</span></div>
  </div>;
}

/** Silence removal option with an explicit explanation for unsupported selections. */
export function SilenceRemovalChoice({ enabled, onChange, disabled = false, unavailableReason }: {
  enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean; unavailableReason?: string;
}) {
  const ui = useUiText();
  const active = enabled && !unavailableReason;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!node.open) node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, [open, mounted]);

  return <>
    <button type="button" className={`${styles.option} ${active ? styles.selected : ""}`} disabled={disabled}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className={styles.optionIcon} aria-hidden="true">{[12, 23, 15, 5, 5, 18, 26, 12].map((height, i) => <i key={i} style={{ height }} />)}</span>
      <span className={styles.optionCopy}><strong>{ui("무음구간 삭제")}</strong><span>{unavailableReason ?? ui("긴 쉼을 줄여, 더 빠르게 이어지는 쇼츠")}</span></span>
      <span className={styles.optionStatus}>{ui(unavailableReason ? "현재 설정에서 사용 불가" : active ? "선택됨" : "선택 안 함")}<span aria-hidden="true">{active ? "✓" : "↗"}</span></span>
    </button>
    {mounted && open ? createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <button type="button" autoFocus className={styles.close} aria-label={ui("무음구간 삭제 닫기")} onClick={() => setOpen(false)}>×</button>
      <h2 id={titleId}>{ui("무음구간 삭제")}</h2>
      <p id={descriptionId} className={styles.description}>{ui("평평한 무음 구간을 잘라, 대화를 촘촘하게 이어요.")}</p>
      <WaveformAnimation />
      {unavailableReason ? <p role="status" className={styles.description}>{unavailableReason}</p> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>{ui("닫기")}</button>
        <button type="button" className={styles.primary} disabled={disabled || Boolean(unavailableReason)} onClick={() => { onChange(!enabled); setOpen(false); }}>{ui(active ? "무음 삭제 끄기" : "무음 삭제 켜기")}</button>
      </div>
    </dialog>, document.body) : null}
  </>;
}
