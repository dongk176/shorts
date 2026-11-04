"use client";

import { useState } from "react";
import styles from "./comment-reactions-control.module.css";

/** Shared by creation and the selected comment in the editor. */
export function CommentReactionsControl({ value, onChange }: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className={styles.root}>
    <button type="button" className={styles.trigger} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span>댓글 반응</span><strong>{value ? "반응 있음" : "반응 없이"}</strong><span aria-hidden>{open ? "−" : "+"}</span>
    </button>
    {open && <div className={styles.options} role="group" aria-label="댓글 반응 표시">
      {[true, false].map((enabled) => <button type="button" key={String(enabled)} aria-pressed={value === enabled}
        className={styles.option} onClick={() => onChange(enabled)}>
        <span key={String(value)} className={styles.preview} aria-hidden="true">
          <span className={styles.identity}><i />시청자</span>
          <span className={styles.copy}>이 장면은 다시 봐도 재밌네</span>
          <span className={`${styles.reactions} ${enabled ? styles.visible : styles.hidden}`}>♡ <b>128</b><span>답글</span></span>
        </span>
        <strong>{enabled ? "반응 있음" : "반응 없이"}</strong>
        <span className={styles.description}>{enabled ? "좋아요·답글도 함께" : "댓글 내용만 깔끔하게"}</span>
      </button>)}
    </div>}
  </div>;
}

export function CommentLikeCountInput({ value, onChange, onBegin, onFinish }: {
  value: number;
  onChange: (value: number) => void;
  onBegin: () => void;
  onFinish: () => void;
}) {
  const [draft, setDraft] = useState(String(value));
  return <label className={styles.count}>좋아요 수
    <input aria-label="좋아요 수" type="number" min={10} max={999999} step={1} value={draft}
      onFocus={onBegin} onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = draft.trim() ? Number(draft) : value;
        const next = Number.isFinite(parsed) ? Math.min(999999, Math.max(10, Math.round(parsed))) : value;
        setDraft(String(next)); onChange(next); onFinish();
      }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
  </label>;
}
