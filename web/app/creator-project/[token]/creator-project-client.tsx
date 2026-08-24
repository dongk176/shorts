"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthControls } from "@/components/auth-controls";
import type { CreatorProjectShareView } from "@/lib/creator-project-shares";
import type { AuthProfile } from "@/lib/session";
import styles from "./creator-project.module.css";

type PlaybackAccess = {
  url: string;
  posterUrl: string | null;
  expiresAt: string;
  renderVersion: number;
};

function remainingLabel(expiresAt: string) {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return "만료됨";
  const hours = Math.ceil(remainingMs / 3_600_000);
  if (hours < 24) return `${hours}시간 뒤 만료`;
  return `${Math.ceil(hours / 24)}일 뒤 만료`;
}

function durationLabel(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function CreatorProjectClient({
  project,
  token,
  viewRequestId,
  user,
  freeTrialEnabled,
}: {
  project: CreatorProjectShareView;
  token: string;
  viewRequestId: string;
  user: AuthProfile | null;
  freeTrialEnabled: boolean;
}) {
  const [playback, setPlayback] = useState<Record<string, PlaybackAccess>>({});
  const [remaining, setRemaining] = useState(() => remainingLabel(project.expiresAt));
  const recordedView = useRef(false);
  const active = project.status === "active";

  const loadPlayback = useCallback(async (shortId: string) => {
    try {
      const response = await fetch(
        `/api/creator-project/${encodeURIComponent(token)}/shorts/${encodeURIComponent(shortId)}/access`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const value = await response.json() as PlaybackAccess;
      setPlayback((current) => ({ ...current, [shortId]: value }));
    } catch {
      // The project page remains usable even when one playback URL refresh fails.
    }
  }, [token]);

  useEffect(() => {
    if (!active || recordedView.current) return;
    recordedView.current = true;
    void fetch(`/api/creator-project/${encodeURIComponent(token)}/visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: viewRequestId }),
      keepalive: true,
    }).catch(() => undefined);
  }, [active, token, viewRequestId]);

  useEffect(() => {
    if (!active) return;
    for (const item of project.shorts) void loadPlayback(item.id);
  }, [active, loadPlayback, project.shorts]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setRemaining(remainingLabel(project.expiresAt)),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, [project.expiresAt]);

  const trackCta = useCallback(() => {
    if (!active) return;
    void fetch(`/api/creator-project/${encodeURIComponent(token)}/cta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        viewRequestId,
        ctaRequestId: crypto.randomUUID(),
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, [active, token, viewRequestId]);

  const cta = user ? (
    <button
      type="button"
      className={styles.cta}
      onClick={() => {
        trackCta();
        window.location.assign("/#workspace");
      }}
    >
      쇼츠 더 만들어보기 <span aria-hidden="true">→</span>
    </button>
  ) : (
    <AuthControls
      user={null}
      next="/#workspace"
      triggerLabel="쇼츠 더 만들어보기"
      triggerClassName={styles.cta}
      onLoginTrigger={trackCta}
      dialogTitle="내 영상으로 쇼츠를 만들어볼까요?"
      dialogDescription="로그인하거나 새로 가입하면 이지컷 제작 화면으로 바로 이어집니다."
    />
  );

  if (!active) {
    return (
      <main className={styles.page}>
        <section className={styles.unavailable}>
          <p className={styles.brand}>Easy <em>Cut</em></p>
          <span className={styles.expiredIcon} aria-hidden="true">⌛</span>
          <p className={styles.eyebrow}>Creator Project</p>
          <h1>이 프로젝트의 7일 공개 기간이 끝났습니다</h1>
          <p>
            영상은 더 이상 공개되지 않지만, 이지컷에서 내 영상으로 쇼츠를 직접 만들어볼 수 있습니다.
          </p>
          <div className={styles.unavailableCta}>{cta}</div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.brand}>Easy <em>Cut</em></p>
        <span className={styles.expiryBadge}>{remaining}</span>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Private Creator Project</p>
        <h1>{project.recipientName}님을 위해 준비한<br /> 전용 쇼츠 프로젝트입니다</h1>
        <p className={styles.privateNotice}>
          <span aria-hidden="true">🔒</span>
          이 링크를 알고 있는 사람만 볼 수 있으며 7일 뒤 만료됩니다
        </p>
        <div className={styles.sourceCard}>
          {project.channelThumbnailUrl ? (
            <Image
              src={project.channelThumbnailUrl}
              width={48}
              height={48}
              unoptimized
              alt=""
              className={styles.channelImage}
            />
          ) : <span className={styles.channelFallback} aria-hidden="true" />}
          <div>
            <strong>{project.videoTitle}</strong>
            <span>{project.channelName}</span>
          </div>
        </div>
      </section>

      <section className={styles.shorts} aria-label="완성된 쇼츠">
        {project.shorts.map((item, index) => {
          const asset = playback[item.id];
          return (
            <article className={styles.shortCard} key={item.id}>
              <div className={styles.videoColumn}>
                <div className={styles.videoShell}>
                  {asset ? (
                    <video
                      key={`${item.id}:${asset.renderVersion}:${asset.url}`}
                      src={asset.url}
                      poster={asset.posterUrl || undefined}
                      controls
                      controlsList="nodownload"
                      playsInline
                      preload="metadata"
                      onError={() => void loadPlayback(item.id)}
                    />
                  ) : (
                    <div className={styles.videoLoading}>영상을 연결하고 있습니다</div>
                  )}
                  <span className={styles.duration}>{durationLabel(item.durationSeconds)}</span>
                </div>
              </div>
              <div className={styles.shortCopy}>
                <span>Shorts {String(index + 1).padStart(2, "0")}</span>
                <h2>{item.hookTitle.replace("\n", " ")}</h2>
                {item.highlightReason ? <p>{item.highlightReason}</p> : null}
              </div>
            </article>
          );
        })}
      </section>

      <section className={styles.conversion}>
        <p className={styles.eyebrow}>Made with Easy Cut</p>
        <h2>긴 영상 하나면 충분합니다</h2>
        <p>
          EasyCut은 긴 영상에서 쇼츠 구간을 찾고 제목과 자막까지 자동으로 완성합니다.
          {freeTrialEnabled ? " 지금 가입하면 20분을 무료로 체험할 수 있습니다." : " 지금 내 영상으로 직접 만들어보세요."}
        </p>
        {cta}
      </section>

      <footer className={styles.footer}>
        <p className={styles.brand}>Easy <em>Cut</em></p>
        <span>AI Shorts Maker</span>
      </footer>
    </main>
  );
}
