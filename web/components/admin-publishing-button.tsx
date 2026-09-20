"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/provider";
import { TikTokPublishingPanel } from "./tiktok-publishing";
import { PlatformIcon, UploadIcon } from "./publish-ui";
import "./youtube-publish.css";

export function AdminPublishingButton({ shortId, title }: { shortId: string; title: string }) {
  const { locale } = useI18n();
  const text = locale === "ko" ? { upload: "업로드", heading: "쇼츠 업로드", help: "완성한 영상을 내 채널에 바로 올리세요.", close: "업로드 창 닫기" }
    : locale === "en" ? { upload: "Upload", heading: "Upload short", help: "Upload your finished video directly to your channel.", close: "Close upload" }
      : { upload: "アップロード", heading: "ショート動画を投稿", help: "完成した動画をチャンネルに投稿しましょう。", close: "閉じる" };
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), heading = useId();
  useEffect(() => {
    const url = new URL(window.location.href);
    try { if (url.searchParams.has("tiktokAccount") && sessionStorage.getItem("easycut-admin-publishing-short") === shortId) setOpen(true); } catch { /* Storage may be disabled. Manual opening still works. */ }
  }, [shortId]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const element = dialog.current, triggerElement = trigger.current;
    return () => { element?.close(); triggerElement?.focus(); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="tool-button publish-trigger" aria-haspopup="dialog" onClick={() => {
      try { sessionStorage.setItem("easycut-admin-publishing-short", shortId); } catch { /* Optional OAuth return preference. */ }
      setOpen(true);
    }}><UploadIcon/>{text.upload}</button>
    {open && createPortal(<dialog ref={dialog} data-i18n-skip className="publish-dialog" aria-labelledby={heading} onCancel={() => setOpen(false)}>
      <header className="publish-dialog-header"><div><h2 id={heading}>{text.heading}</h2><p>{text.help}</p></div><button className="publish-close" type="button" aria-label={text.close} onClick={() => setOpen(false)}>×</button></header>
      <div className="publish-tabs"><span style={{ display: "flex", alignItems: "center", gap: 8, padding: 16 }}><PlatformIcon name="TikTok"/>TikTok</span></div>
      <div className="publish-dialog-body"><TikTokPublishingPanel shortId={shortId} title={title}/></div>
    </dialog>, document.body)}
  </>;
}
