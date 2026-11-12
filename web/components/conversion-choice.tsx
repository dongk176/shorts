"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./conversion-choice.module.css";
import type { CreationFormat } from "@/lib/creation-format";

function FormatAnimation({ format }: { format: CreationFormat }) {
  return <span aria-hidden="true" className={`${styles.animation} ${format === "shorts" ? styles.shorts : styles.midform}`}>
    <span className={styles.sourceLabel}>원본 영상</span>
    <span className={styles.sourceTrack}>{[0, 1, 2, 3, 4, 5].map(i => <span key={i} className={styles.sourceScene} />)}</span>
    <span className={styles.flowArrow}>↓</span>
    <span className={styles.outputs}>
      {(format === "shorts" ? [0, 1, 2] : [0]).map(i => <span key={i} className={styles.video}>
        <span className={styles.videoScene}><span className={styles.person} /><span className={styles.person} /></span>
        {format === "midform" ? <span className={styles.joinedScenes}><i /><i /><i /></span> : null}
        <span className={styles.caption} /><span className={styles.playhead} />
      </span>)}
    </span>
    <span className={styles.resultLabel}>{format === "shorts" ? "짧은 영상 여러 편" : "장면을 이어 붙인 한 편"}</span>
  </span>;
}

export function ConversionChoice({ open, onClose, onChoose }: {
  open: boolean; onClose: () => void; onChoose: (mode: CreationFormat) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
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
  if (!mounted) return null;
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="conversion-choice-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <button type="button" className={styles.close} aria-label="제작 방식 선택 닫기" onClick={onClose}>×</button>
    <h2 id="conversion-choice-title">어떤 영상으로 만들까요?</h2>
    <div className={styles.choices}>
      <button type="button" autoFocus className={`${styles.choice} ${styles.shortsChoice}`} onClick={() => onChoose("shorts")}>
        <FormatAnimation format="shorts" />
        <span className={styles.copy}><span className={styles.title}><strong>숏폼</strong><span aria-hidden="true">↗</span></span>
          <span className={styles.description}>눈길을 끄는 장면을 짧은 쇼츠 여러 편으로</span></span>
      </button>
      <button type="button" className={`${styles.choice} ${styles.midformChoice}`} onClick={() => onChoose("midform")}>
        <FormatAnimation format="midform" />
        <span className={styles.copy}><span className={styles.title}><strong>미들폼</strong><span aria-hidden="true">↗</span></span>
          <span className={styles.description}>볼 만한 장면을 자연스럽게 이어 한 편으로</span></span>
      </button>
    </div>
  </dialog>, document.body);
}
