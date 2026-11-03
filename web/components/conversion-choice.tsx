"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./conversion-choice.module.css";

export function ConversionChoice({ open, onClose, onChoose }: {
  open: boolean; onClose: () => void; onChoose: (mode: "shorts" | "midform") => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [explaining, setExplaining] = useState(false);
  useEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, [open]);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="conversion-choice-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <button type="button" className={styles.close} aria-label="제작 방식 선택 닫기" onClick={onClose}>×</button>
    <h2 id="conversion-choice-title">어떤 영상으로 만들까요?</h2>
    <div className={styles.choices}>
      <button type="button" className={styles.choice} onClick={() => onChoose("shorts")}>
        <strong>쇼츠로 만들기</strong><span aria-hidden="true">→</span>
      </button>
      <button type="button" className={styles.choice} onClick={() => onChoose("midform")}>
        <strong>중폼으로 한 편 뽑기</strong><span aria-hidden="true">→</span>
      </button>
    </div>
    <button type="button" className={styles.help} aria-expanded={explaining} aria-controls="midform-explanation"
      onClick={() => setExplaining(value => !value)}><span aria-hidden="true">ⓘ</span> 중폼이 뭔가요? <span aria-hidden="true">{explaining ? "−" : "+"}</span></button>
    {explaining && <section id="midform-explanation" className={styles.explanation} aria-label="중폼 설명">
      <p>긴 영상에서 볼 만한 장면을 골라, 원래 순서대로 이어 붙인 한 편의 영상이에요. 불필요한 무음은 자동으로 줄이고, 길이는 내용에 맞춰 정해져요.</p>
    </section>}
  </dialog>;
}
