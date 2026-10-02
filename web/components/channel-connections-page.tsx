"use client";

import { useI18n } from "@/lib/i18n/provider";
import { createYoutubeText } from "@/lib/youtube-accounts/i18n";
import { YoutubeAccountConnections } from "./youtube-account-connections";
import "./channel-connections-page.css";
import { uploadMaintenanceText } from "@/lib/upload-maintenance";

export function ChannelConnectionsPage({ adminEnabled = false }: { adminEnabled?: boolean }) {
  const { locale } = useI18n();
  const yt = createYoutubeText(locale);
  return <main className="channel-connections-page" data-i18n-skip>
    <header className="channel-connections-heading">
      <h1>{yt("채널 연동")}</h1>
      <p>{adminEnabled ? yt("채널을 연결하고, 프로젝트에서 바로 업로드하세요.") : uploadMaintenanceText(locale).channels}</p>
    </header>
    <YoutubeAccountConnections />
    <p className="channel-platforms-soon"><span>Instagram · TikTok · Threads</span><span>{yt("추가 플랫폼 준비 중")}</span></p>
  </main>;
}
