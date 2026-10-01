"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/provider";
import { TikTokPublishingPanel } from "./tiktok-publishing";
import { YoutubeAccountConnections } from "./youtube-account-connections";
import { PlatformIcon, UploadIcon } from "./publish-ui";
import "./youtube-publish.css";

const available = ["YouTube", "TikTok", "Instagram", "Threads"] as const;

export function AdminPublishingButton({ shortId, title, adminEnabled = false, tiktokEnabled = false, youtubeEnabled = false }: { shortId: string; title: string; adminEnabled?: boolean; metaOnly?: boolean; metaEnabled?: boolean; tiktokEnabled?: boolean; youtubeEnabled?: boolean }) {
  const { locale } = useI18n();
  const text = locale === "ko" ? { upload: "업로드", heading: "쇼츠 업로드", help: "완성한 영상을 내 채널에 바로 올리세요.", close: "업로드 창 닫기" }
    : locale === "en" ? { upload: "Upload", heading: "Upload short", help: "Upload your finished video directly to your channel.", close: "Close upload" }
      : { upload: "アップロード", heading: "ショート動画を投稿", help: "完成した動画をチャンネルに投稿しましょう。", close: "閉じる" };
  const maintenance = locale === "ko" ? {
    heading: "업로드 기능을 잠시 점검하고 있어요",
    message: "더 안정적인 서비스를 제공하기 위해 업로드 기능을 개선하고 있습니다.",
    availability: "준비가 완료되면 다시 이용하실 수 있어요.",
    apology: "이용에 불편을 드려 죄송합니다.", confirm: "확인",
  } : locale === "en" ? {
    heading: "Uploads are temporarily unavailable",
    message: "We are improving uploads to provide a more reliable service.",
    availability: "You can use this feature again once it is ready.",
    apology: "We apologize for the inconvenience.", confirm: "OK",
  } : {
    heading: "アップロード機能を一時的にメンテナンスしています",
    message: "より安定したサービスを提供するため、アップロード機能を改善しています。",
    availability: "準備が整い次第、再びご利用いただけます。",
    apology: "ご不便をおかけして申し訳ございません。", confirm: "確認",
  };
  const [platform, setPlatform] = useState<typeof available[number]>(available[0] || "YouTube");
  const selected = available.includes(platform) ? platform : available[0];
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null), heading = useId(), description = useId();
  useEffect(() => {
    const url = new URL(window.location.href);
    try { if (sessionStorage.getItem("easycut-admin-publishing-short") === shortId) { for (const name of available) { if (url.searchParams.has(`${name.toLowerCase()}Account`)) { setPlatform(name); setOpen(true); } } } } catch { /* Storage may be disabled. Manual opening still works. */ }
  }, [shortId]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const element = dialog.current, triggerElement = trigger.current;
    return () => { element?.close(); triggerElement?.focus(); };
  }, [open]);
  if (!selected) return null;
  return <>
    <button ref={trigger} type="button" className="tool-button publish-trigger" aria-haspopup="dialog" onClick={() => {
      try { if (adminEnabled) sessionStorage.setItem("easycut-admin-publishing-short", shortId); } catch { /* Optional OAuth return preference. */ }
      setPlatform(available[0]);
      setOpen(true);
    }}><UploadIcon/>{text.upload}<span className="publish-beta-label">{locale === "ko" ? "베타" : locale === "ja" ? "ベータ" : "Beta"}</span></button>
    {open && !adminEnabled && createPortal(<dialog ref={dialog} data-i18n-skip className="publish-status-dialog" aria-labelledby={heading} aria-describedby={description} onCancel={() => setOpen(false)}>
      <h2 id={heading}>{maintenance.heading}</h2>
      <div id={description}><p>{maintenance.message}<br/>{maintenance.availability}</p><p>{maintenance.apology}</p></div>
      <div className="publish-status-actions"><button className="publish-primary" type="button" onClick={() => setOpen(false)}>{maintenance.confirm}</button></div>
    </dialog>, document.body)}
    {open && adminEnabled && createPortal(<dialog ref={dialog} data-i18n-skip className="publish-dialog" aria-labelledby={heading} onCancel={() => setOpen(false)}>
      <header className="publish-dialog-header"><div><h2 id={heading}>{text.heading}</h2><p>{text.help}</p></div><button className="publish-close" type="button" aria-label={text.close} onClick={() => setOpen(false)}>×</button></header>
      <div className="publish-tabs">{available.map(name => <button type="button" key={name} className={selected === name ? "is-active" : ""} aria-pressed={selected === name} onClick={() => setPlatform(name)}><PlatformIcon name={name}/>{name}</button>)}</div>
      <div className="publish-dialog-body">{selected === "YouTube" && youtubeEnabled
        ? <YoutubeAccountConnections shortId={shortId} title={title} previewUrl={`/api/youtube/accounts/media/${shortId}`}/>
        : selected === "TikTok" && tiktokEnabled
          ? <TikTokPublishingPanel shortId={shortId} title={title}/>
        : <div className="publish-empty" role="status"><PlatformIcon name={selected}/><p>{locale === "ko" ? "해당 플랫폼은 서비스 준비중입니다." : locale === "en" ? "This platform is coming soon." : "このプラットフォームはサービス準備中です。"}</p></div>}</div>
    </dialog>, document.body)}
  </>;
}
