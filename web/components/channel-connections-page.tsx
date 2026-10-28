"use client";

import { useI18n } from "@/lib/i18n/provider";
import { createYoutubeText } from "@/lib/youtube-accounts/i18n";
import { YoutubeAccountConnections } from "./youtube-account-connections";
import "./channel-connections-page.css";
import { TikTokPublishingPanel } from "./tiktok-publishing";
import Link from "next/link";
import { PlatformIcon } from "./publish-ui";
import { uploadMaintenanceText } from "@/lib/upload-maintenance";

export function ChannelConnectionsPage({ adminEnabled = false, tiktokEnabled = false, instagramEnabled = false }: { adminEnabled?: boolean; tiktokEnabled?: boolean; instagramEnabled?: boolean }) {
  const { locale } = useI18n();
  const yt = createYoutubeText(locale);
  const instagram = locale === "ko" ? { action: "프로젝트에서 연결하기", help: "완성된 쇼츠의 업로드 → Instagram에서 프로페셔널 계정을 연결하고 릴스로 게시하세요." }
    : locale === "ja" ? { action: "プロジェクトで連携", help: "完成したショート動画の「アップロード」→ Instagramからプロアカウントを連携し、リールを投稿できます。" }
      : { action: "Connect from a project", help: "Open Upload → Instagram on a finished short to connect your professional account and publish a Reel." };
  const comingSoon = [!instagramEnabled && "Instagram", !tiktokEnabled && "TikTok", "Threads"].filter(Boolean).join(" · ");
  return <main className="channel-connections-page" data-i18n-skip>
    <header className="channel-connections-heading">
      <h1>{yt("채널 연동")}</h1>
      <p>{adminEnabled || tiktokEnabled || instagramEnabled ? yt("채널을 연결하고, 프로젝트에서 바로 업로드하세요.") : uploadMaintenanceText(locale).channels}</p>
    </header>
    {tiktokEnabled && <TikTokPublishingPanel />}
    {instagramEnabled && <section className="publish-channel-card" aria-label="Instagram">
      <div className="publish-card-heading"><h2><PlatformIcon name="Instagram"/>Instagram</h2><Link className="publish-outline" href={locale === "en" ? "/en/projects" : locale === "ja" ? "/jp/projects" : "/projects"}>{instagram.action}</Link></div>
      <p className="publish-note">{instagram.help}</p>
    </section>}
    <YoutubeAccountConnections />
    <p className="channel-platforms-soon"><span>{comingSoon}</span><span>{yt("추가 플랫폼 준비 중")}</span></p>
  </main>;
}
