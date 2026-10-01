"use client";
import { CapturedImage } from "./captured-image";
import { useRef } from "react";
import { captures, displayDate } from "./data";
import styles from "./updates.module.css";
export function AnnotatedScreen({ image }: {
    image: string;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const shot = captures[image];
    const illustration = <div className={styles.screenshot}><CapturedImage image={image}/>{shot.annotations.map((a, i) => <span key={a.label} className={styles.highlight} style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }} aria-hidden="true"><b>{i + 1}</b></span>)}</div>;
    return <figure className={styles.figure}><button className={styles.zoomButton} onClick={() => dialog.current?.showModal()} aria-label="화면 캡처 크게 보기">{illustration}<span className={styles.zoomHint}>크게 보기 ↗</span></button><figcaption>실제 이지컷 화면 · {displayDate(shot.capturedAt ?? "2026-09-30")} 캡처</figcaption>{shot.annotations.length ? <ol className={styles.annotationList}>{shot.annotations.map((a, i) => <li key={a.label}><b>{i + 1}</b>{a.label}</li>)}</ol> : null}<dialog ref={dialog} className={styles.imageDialog} aria-label="실제 화면 크게 보기" onClick={e => { if (e.target === e.currentTarget)
        dialog.current?.close(); }}><div><button className={styles.closeDialog} autoFocus onClick={() => dialog.current?.close()}>닫기 ×</button>{illustration}<p>{shot.alt}</p></div></dialog></figure>;
}
