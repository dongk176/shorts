"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./silence-removal-choice.module.css";

const waveform = [10, 20, 34, 16, 42, 54, 28, 44, 20, 36, 58, 46, 24, 40, 18, 30, 48, 22];

function SpeechWave({ variant = 0 }: { variant?: number }) {
  return <span className={styles.speech}>{waveform.map((height, index) =>
    <i key={index} style={{ height: `${waveform[(index + variant) % waveform.length] || height}px` }} />,
  )}</span>;
}

function WaveformAnimation() {
  return <div className={styles.demonstration} role="img" aria-label="음성 파형 사이의 평평한 무음 두 구간을 잘라내고, 남은 대화 파형 세 구간을 이어 붙이는 예시">
    <div className={styles.trackHeading}><span>원본 쇼츠</span><span className={styles.beforeHint}>말 사이에 긴 쉼</span></div>
    <div className={styles.track} aria-hidden="true">
      <SpeechWave /><span className={styles.gap}><span>무음</span><i /></span>
      <SpeechWave variant={5} /><span className={`${styles.gap} ${styles.smallGap}`}><span>무음</span><i /></span>
      <SpeechWave variant={9} />
    </div>
    <div className={styles.cutDirection} aria-hidden="true"><span>✂</span><i /></div>
    <div className={styles.trackHeading}><span className={styles.afterHeading}>무음 삭제 후</span><span className={styles.afterHint}>대화가 바로 이어져요</span></div>
    <div className={`${styles.track} ${styles.trimmed}`} aria-hidden="true">
      <SpeechWave /><span className={styles.gap}><span className={styles.cutPiece}><b>무음</b><i /></span></span>
      <SpeechWave variant={5} /><span className={`${styles.gap} ${styles.smallGap}`}><span className={styles.cutPiece}><b>무음</b><i /></span></span>
      <SpeechWave variant={9} /><span className={styles.playhead} />
    </div>
    <div className={styles.legend}><span><i />대화 유지</span><span><i />무음 잘라내기</span></div>
  </div>;
}

/** Administrator-only silence removal option. */
export function SilenceRemovalChoice({ enabled, onChange, disabled = false }: {
  enabled: boolean; onChange: (enabled: boolean) => void; disabled?: boolean;
}) {
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
    <button type="button" className={`${styles.option} ${enabled ? styles.selected : ""}`} disabled={disabled}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className={styles.optionIcon} aria-hidden="true">{[12, 23, 15, 5, 5, 18, 26, 12].map((height, i) => <i key={i} style={{ height }} />)}</span>
      <span className={styles.optionCopy}><strong>무음구간 삭제</strong><span>긴 쉼을 줄여, 더 빠르게 이어지는 쇼츠</span></span>
      <span className={styles.optionStatus}>{enabled ? "선택됨" : "선택 안 함"}<span aria-hidden="true">{enabled ? "✓" : "↗"}</span></span>
    </button>
    {mounted && open ? createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={event => { event.preventDefault(); setOpen(false); }}>
      <button type="button" autoFocus className={styles.close} aria-label="무음구간 삭제 닫기" onClick={() => setOpen(false)}>×</button>
      <h2 id={titleId}>무음구간 삭제</h2>
      <p id={descriptionId} className={styles.description}>평평한 무음 구간을 잘라, 대화를 촘촘하게 이어요.</p>
      <WaveformAnimation />
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => setOpen(false)}>닫기</button>
        <button type="button" className={styles.primary} onClick={() => { onChange(!enabled); setOpen(false); }}>{enabled ? "무음 삭제 끄기" : "무음 삭제 켜기"}</button>
      </div>
    </dialog>, document.body) : null}
  </>;
}
