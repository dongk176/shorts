"use client";

import { useEffect, useRef, useState } from "react";
import type { RankingRemote } from "@/lib/ranking-shorts";
import { rankingEmbedUrl } from "@/lib/ranking-embed";

// A paused frame/cover only. This never prepares or downloads a source on a worker.
export function RankingThumbnail({ videoUrl, remote, time = 0.1, fit = "cover", lazy = true }: {
  videoUrl?: string;
  remote?: RankingRemote;
  time?: number;
  fit?: "cover" | "contain";
  lazy?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const media = video.current;
    if (media && media.readyState >= 1)
      media.currentTime = Math.max(0, Math.min(time, Number.isFinite(media.duration) ? Math.max(0, media.duration - 0.05) : time));
  }, [time]);
  useEffect(() => {
    if (!lazy || !container.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "100px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [lazy]);
  const mediaStyle = { width: "100%", height: "100%", objectFit: fit } as const;
  return (
    <div ref={container} className="h-full w-full overflow-hidden bg-neutral-950" aria-hidden="true">
      {visible && !failed && videoUrl ? (
        <video ref={video} src={videoUrl} muted playsInline preload="metadata" tabIndex={-1} style={mediaStyle}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            video.currentTime = Math.max(0, Math.min(time, Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : time));
          }}
          onError={() => setFailed(true)} />
      ) : visible && !failed && remote?.platform === "youtube" && /^[\w-]{11}$/.test(remote.videoId) ? (
        // Public covers should load directly, without the image optimizer or source worker.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://i.ytimg.com/vi/${remote.videoId}/hqdefault.jpg`} alt="" style={mediaStyle} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : visible && !failed && remote?.platform === "tiktok" && /^\d{10,25}$/.test(remote.videoId) ? (
        <iframe title="틱톡 영상 표지" tabIndex={-1} loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
          src={`${rankingEmbedUrl(remote)}&controls=0&play_button=0&description=0&music_info=0&autoplay=0&muted=1`}
          style={{ width: "100%", height: "100%", border: 0, pointerEvents: "none" }} />
      ) : (
        <div className="flex h-full min-h-24 items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-950 text-sm text-neutral-500">랭킹 쇼츠</div>
      )}
    </div>
  );
}
