"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { RankingRemote } from "@/lib/ranking-shorts";
import {
  rankingEmbedUrl,
  rankingInstagramHeight,
  rankingTikTokMessage,
} from "@/lib/ranking-embed";
import {
  createYouTubePreview,
  type YouTubePreviewPlayer,
} from "@/lib/ranking-youtube-preview";

export type RankingRemoteHandle = {
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
};
type YouTubePlayer = YouTubePreviewPlayer & {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (time: number, ahead: boolean) => void;
  cueVideoById: (options: { videoId: string; startSeconds: number }) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};
type YouTubeAPI = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: () => void;
      };
    },
  ) => YouTubePlayer;
};
declare global {
  interface Window {
    YT?: YouTubeAPI;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let youtubeAPI: Promise<YouTubeAPI> | undefined;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeAPI)
    youtubeAPI = new Promise<YouTubeAPI>((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      const timer = window.setTimeout(
        () => reject(new Error("플레이어를 불러오지 못했습니다.")),
        20000,
      );
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        window.clearTimeout(timer);
        if (window.YT?.Player) resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timer);
        script.remove();
        reject(new Error("플레이어를 불러오지 못했습니다."));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      youtubeAPI = undefined;
      throw error;
    });
  return youtubeAPI;
}

export const RankingRemotePlayer = forwardRef<
  RankingRemoteHandle,
  {
    remote: RankingRemote;
    start: number;
    label: string;
    suspended: boolean;
    onTime: (time: number) => void;
    onPlaying: (playing: boolean) => void;
    onUnavailable: () => void;
  }
>(function RankingRemotePlayer(
  { remote, start, label, onTime, onPlaying, onUnavailable, suspended },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const youtube = useRef<YouTubePlayer | null>(null);
  const preview = useRef<ReturnType<typeof createYouTubePreview> | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const latest = useRef({ start, onTime, onPlaying, onUnavailable });
  latest.current = { start, onTime, onPlaying, onUnavailable };
  const [error, setError] = useState("");
  const [instagramHeight, setInstagramHeight] = useState(780);
  const url = rankingEmbedUrl(remote);
  function message(type: string, value?: number) {
    frame.current?.contentWindow?.postMessage(
      { type, value, "x-tiktok-player": true },
      "https://www.tiktok.com",
    );
  }
  useImperativeHandle(
    ref,
    () => ({
      seek(time) {
        if (remote.platform === "youtube") {
          setError("");
          if (preview.current) preview.current.seek(time);
          else pendingSeek.current = time;
        }
        if (remote.platform === "tiktok") {
          message("pause");
          message("seekTo", time);
        }
        latest.current.onTime(time);
      },
      play() {
        if (remote.platform === "youtube") preview.current?.play();
        else if (remote.platform === "tiktok") message("play");
      },
      pause() {
        if (remote.platform === "youtube") preview.current?.pause();
        else if (remote.platform === "tiktok") message("pause");
      },
    }),
    [remote.platform],
  );

  useEffect(() => {
    let alive = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    let instance: YouTubePlayer | null = null;
    if (suspended) return;
    let unavailable = false;
    const fail = () => {
      if (alive && !unavailable) {
        unavailable = true;
        clearTimeout(readyTimer);
        latest.current.onUnavailable();
        setError(
          "플레이어를 연결하지 못했습니다. 원본 링크에서 확인하거나 파일을 선택해 주세요.",
        );
        latest.current.onPlaying(false);
      }
    };
    const readyTimer = setTimeout(fail, 20000);
    if (remote.platform === "youtube") {
      void loadYouTube()
        .then((api) => {
          if (!alive || !host.current) return;
          const container = document.createElement("div");
          host.current.appendChild(container);
          instance = new api.Player(container, {
            videoId: remote.videoId,
            width: "100%",
            height: "100%",
            playerVars: {
              origin: window.location.origin,
              playsinline: 1,
              rel: 0,
            },
            events: {
              onReady: () => {
                if (!alive || !instance) return;
                clearTimeout(readyTimer);
                instance.cueVideoById({
                  videoId: remote.videoId,
                  startSeconds: latest.current.start,
                });
                preview.current = createYouTubePreview(instance, () => {
                  if (alive)
                    setError(
                      "장면을 불러오지 못했습니다. 플레이어의 재생 버튼을 눌러 다시 확인해 주세요.",
                    );
                });
                if (pendingSeek.current !== null) {
                  preview.current.seek(pendingSeek.current);
                  pendingSeek.current = null;
                }
                interval = setInterval(() => {
                  if (
                    !preview.current?.seeking &&
                    instance?.getPlayerState() === 1
                  )
                    latest.current.onTime(instance.getCurrentTime());
                }, 100);
              },
              onStateChange: ({ data }) => {
                if (alive)
                  latest.current.onPlaying(
                    !preview.current?.seeking && data === 1,
                  );
              },
              onError: fail,
            },
          });
          youtube.current = instance;
        })
        .catch(fail);
    }
    const listener = (event: MessageEvent) => {
      if (!alive) return;
      if (remote.platform === "instagram") {
        const height = rankingInstagramHeight(
          event,
          frame.current?.contentWindow ?? null,
        );
        if (height !== null) {
          clearTimeout(readyTimer);
          setInstagramHeight(height);
        }
        return;
      }
      if (remote.platform !== "tiktok") return;
      const data = rankingTikTokMessage(
        event,
        frame.current?.contentWindow ?? null,
      );
      if (data?.type === "ready") {
        clearTimeout(readyTimer);
        message("seekTo", latest.current.start);
      }
      if (data?.type === "time") latest.current.onTime(data.time);
      if (data?.type === "state") latest.current.onPlaying(data.state === 1);
      if (data?.type === "error") fail();
    };
    window.addEventListener("message", listener);
    return () => {
      alive = false;
      clearInterval(interval);
      clearTimeout(readyTimer);
      window.removeEventListener("message", listener);
      preview.current?.dispose();
      preview.current = null;
      pendingSeek.current = null;
      instance?.destroy();
      youtube.current = null;
    };
  }, [remote.platform, remote.videoId, suspended]);

  return (
    <div className="ranking-remote-player">
      {suspended ? (
        <div className="ranking-remote-frame" />
      ) : remote.platform === "youtube" ? (
        <div ref={host} className="ranking-remote-frame" aria-label={label} />
      ) : (
        <iframe
          ref={frame}
          className={`ranking-remote-frame is-${remote.platform}`}
          src={url}
          title={label}
          style={
            remote.platform === "instagram"
              ? { height: instagramHeight }
              : undefined
          }
          scrolling={remote.platform === "instagram" ? "no" : undefined}
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      )}
      {error ? (
        <p role="alert" className="ranking-error">
          {error}
        </p>
      ) : null}
      <a
        className="ranking-original-link"
        href={remote.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        원본 열기 ↗
      </a>
    </div>
  );
});
