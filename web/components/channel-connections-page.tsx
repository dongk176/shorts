"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { createYoutubeText } from "@/lib/youtube-accounts/i18n";
import { PlatformIcon } from "./publish-ui";
import { YoutubeAccountConnections } from "./youtube-account-connections";
import "./channel-connections-page.css";

export function ChannelConnectionsPage() {
  const { locale } = useI18n();
  const yt = createYoutubeText(locale);
  const [notice, setNotice] = useState<string | null>(null);
  return <main className="channel-connections-page" data-i18n-skip>
    <header className="channel-connections-heading">
      <h1>{yt("채널 연동")}</h1>
      <p>{yt("채널을 연결하고, 프로젝트에서 바로 업로드하세요.")}</p>
    </header>
    <YoutubeAccountConnections />
    {notice && <p className="publish-notice" role="status">{notice}</p>}
    {["Instagram", "TikTok", "Threads"].map(name => <section key={name} className="publish-channel-card publish-coming" aria-label={name}>
      <div className="publish-card-heading">
        <h2><PlatformIcon name={name}/>{name}</h2>
        <button type="button" className="publish-outline" onClick={() => setNotice(yt("해당 플랫폼은 서비스 준비중입니다."))}>{yt("준비 중")}</button>
      </div>
      <p className="publish-muted">{yt("해당 플랫폼은 서비스 준비중입니다.")}</p>
    </section>)}
  </main>;
}
