"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/provider";
import { MetaPublishingPanel } from "./meta-publishing";
import { TikTokPublishingPanel } from "./tiktok-publishing";
import { YoutubeAccountConnections } from "./youtube-account-connections";
import { PlatformIcon, UploadIcon } from "./publish-ui";
import "./youtube-publish.css";

import { uploadMaintenanceText } from "@/lib/upload-maintenance";

const available = ["YouTube", "TikTok", "Instagram", "Threads"] as const;

export function AdminPublishingButton({ shortId, title, adminEnabled = false, metaEnabled = false, instagramEnabled = false, tiktokEnabled = false, youtubeEnabled = false }: { shortId: string; title: string; adminEnabled?: boolean; metaOnly?: boolean; metaEnabled?: boolean; instagramEnabled?: boolean; tiktokEnabled?: boolean; youtubeEnabled?: boolean }) {
  const { locale } = useI18n();
  const text = locale === "ko" ? { upload: "업로드", heading: "쇼츠 업로드", help: "완성한 영상을 내 채널에 바로 올리세요.", close: "업로드 창 닫기" }
    : locale === "en" ? { upload: "Upload", heading: "Upload short", help: "Upload your finished video directly to your channel.", close: "Close upload" }
      : { upload: "アップロード", heading: "ショート動画を投稿", help: "完成した動画をチャンネルに投稿しましょう。", close: "閉じる" };
  const maintenance = uploadMaintenanceText(locale);
  const dialogEnabled = adminEnabled || tiktokEnabled || metaEnabled || instagramEnabled;
  const defaultPlatform = !adminEnabled && (metaEnabled || instagramEnabled) ? "Instagram" : !adminEnabled && tiktokEnabled ? "TikTok" : "YouTube";
  const [platform, setPlatform] = useState<typeof available[number]>(defaultPlatform);
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
      try { if (dialogEnabled) sessionStorage.setItem("easycut-admin-publishing-short", shortId); } catch { /* Optional OAuth return preference. */ }
      setPlatform(defaultPlatform);
      setOpen(true);
    }}><UploadIcon/>{text.upload}<span className="publish-beta-label">{dialogEnabled ? (locale === "ko" ? "베타" : locale === "ja" ? "ベータ" : "Beta") : maintenance.badge}</span></button>
    {open && !dialogEnabled && createPortal(<dialog ref={dialog} data-i18n-skip className="publish-status-dialog" aria-labelledby={heading} aria-describedby={description} onCancel={() => setOpen(false)}>
      <h2 id={heading}>{maintenance.heading}</h2>
      <div id={description}><p>{maintenance.message}<br/>{maintenance.availability}</p><p>{maintenance.alternative}</p><p>{maintenance.apology}</p></div>
      <div className="publish-status-actions"><a className="publish-primary" href={`/api/shorts/${encodeURIComponent(shortId)}/download`} download>{maintenance.download}</a><button className="publish-primary" type="button" onClick={() => setOpen(false)}>{maintenance.confirm}</button></div>
    </dialog>, document.body)}
    {open && dialogEnabled && createPortal(<dialog ref={dialog} data-i18n-skip className="publish-dialog" aria-labelledby={heading} onCancel={() => setOpen(false)}>
      <header className="publish-dialog-header"><div><h2 id={heading}>{text.heading}</h2><p>{text.help}</p></div><button className="publish-close" type="button" aria-label={text.close} onClick={() => setOpen(false)}>×</button></header>
      <div className="publish-tabs">{available.map(name => <button type="button" key={name} className={selected === name ? "is-active" : ""} aria-pressed={selected === name} onClick={() => setPlatform(name)}><PlatformIcon name={name}/>{name}</button>)}</div>
      <div className="publish-dialog-body">{selected === "YouTube" && adminEnabled && youtubeEnabled
        ? <YoutubeAccountConnections shortId={shortId} title={title} previewUrl={`/api/youtube/accounts/media/${shortId}`}/>
        : selected === "YouTube" && !adminEnabled
          ? <div className="publish-empty" role="status"><PlatformIcon name="YouTube"/><h3>{maintenance.heading}</h3><p>{maintenance.message}</p><p>{maintenance.alternative}</p><a className="publish-primary" href={`/api/shorts/${encodeURIComponent(shortId)}/download`} download>{maintenance.download}</a></div>
        : selected === "TikTok" && tiktokEnabled
          ? <TikTokPublishingPanel shortId={shortId} title={title}/>
        : (selected === "Instagram" && (metaEnabled || instagramEnabled) || selected === "Threads" && metaEnabled)
          ? <MetaPublishingPanel key={selected} platform={selected === "Instagram" ? "instagram" : "threads"} shortId={shortId} title={title}/>
        : <div className="publish-empty" role="status"><PlatformIcon name={selected}/><p>{locale === "ko" ? "해당 플랫폼은 서비스 준비중입니다." : locale === "en" ? "This platform is coming soon." : "このプラットフォームはサービス準備中です。"}</p></div>}</div>
    </dialog>, document.body)}
  </>;
}
