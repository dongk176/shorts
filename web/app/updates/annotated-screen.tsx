"use client";
import { CapturedImage } from "./captured-image";
import { useRef } from "react";
import type { UpdateShot } from "@/lib/update-content";
import { legacyShot, displayDate } from "./data";
import type { SiteLocale } from "@/lib/i18n/config";
import { updateCopy } from "./copy";
import styles from "./updates.module.css";
export function AnnotatedScreen({ image, shot: suppliedShot, locale = "ko" }: {
    image: string;
    shot?: UpdateShot; locale?: SiteLocale;
}) {
    const c = updateCopy(locale);
    const dialog = useRef<HTMLDialogElement>(null);
    const shot = suppliedShot ?? legacyShot(image);
    const illustration = <div className={styles.screenshot}><CapturedImage image={image} shot={shot}/>{shot.annotations.map((a, i) => <span key={a.label} className={styles.highlight} style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }} aria-hidden="true"><b>{i + 1}</b></span>)}</div>;
    return <figure className={styles.figure}><button className={styles.zoomButton} onClick={() => dialog.current?.showModal()} aria-label={c.zoomLabel}>{illustration}<span className={styles.zoomHint}>{c.zoom} ↗</span></button><figcaption>{c.capture(displayDate(shot.capturedAt ?? "2026-09-30"))}</figcaption>{shot.annotations.length ? <ol className={styles.annotationList}>{shot.annotations.map((a, i) => <li key={a.label}><b>{i + 1}</b>{a.label}</li>)}</ol> : null}<dialog ref={dialog} className={styles.imageDialog} aria-label={c.zoomLabel} onClick={e => { if (e.target === e.currentTarget)
        dialog.current?.close(); }}><div><button className={styles.closeDialog} autoFocus onClick={() => dialog.current?.close()}>{c.close} ×</button>{illustration}<p>{shot.alt}</p></div></dialog></figure>;
}
