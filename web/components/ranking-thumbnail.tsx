"use client";

import { useUiText } from "@/lib/i18n/use-ui-text";
import { useEffect, useRef, useState } from "react";
import type { RankingRemote } from "@/lib/ranking-shorts";
import { rankingYoutubeCovers } from "@/lib/ranking-covers";

// A paused frame/cover only. This never prepares or downloads a source on a worker.
export function RankingThumbnail({ videoUrl, remote, time = 0.1, fit = "cover", lazy = true, portrait = false }: {
  videoUrl?: string;
  remote?: RankingRemote;
  time?: number;
  fit?: "cover" | "contain";
  lazy?: boolean;
  portrait?: boolean;
}) {
  const ui = useUiText();
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [failed, setFailed] = useState(false);
  const [coverIndex, setCoverIndex] = useState(0);
  const covers = remote?.platform === "youtube" ? rankingYoutubeCovers(remote.videoId, portrait) : [];
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
      ) : visible && !failed && covers[coverIndex] ? (
        // Public covers should load directly, without the image optimizer or source worker.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={covers[coverIndex]} alt="" style={mediaStyle} referrerPolicy="no-referrer"
          onLoad={event => {
            // ytimg sometimes returns a valid tiny placeholder image for a
            // missing variant; browsers can fire load instead of error.
            if (event.currentTarget.naturalWidth <= 120 && event.currentTarget.naturalHeight <= 90)
              setCoverIndex(index => index === coverIndex ? index + 1 : index);
          }}
          onError={() => setCoverIndex(index => index === coverIndex ? index + 1 : index)} />
      ) : (
        <div className="flex h-full min-h-24 items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-950 text-sm text-neutral-500">{ui("랭킹 쇼츠")}</div>
      )}
    </div>
  );
}
