import type { RankingRemote } from "./ranking-shorts";

// Full video links can be embedded without waking a worker or resolving metadata.
// Short redirect links and Instagram keep the server preparation path.
export function rankingDirectRemote(input: string): RankingRemote | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    const host = url.hostname.toLowerCase();
    let videoId: string | undefined;
    if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      videoId = url.pathname === "/watch"
        ? url.searchParams.get("v") ?? undefined
        : /^\/(?:shorts|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    } else if (host === "youtu.be") {
      videoId = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
    }
    if (videoId && /^[\w-]{11}$/.test(videoId))
      return { platform: "youtube", videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
    if (["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host)) {
      const match = /^\/(@[\w.-]+)\/video\/(\d{10,25})\/?$/.exec(url.pathname);
      if (match)
        return { platform: "tiktok", videoId: match[2], url: `https://www.tiktok.com/${match[1]}/video/${match[2]}` };
    }
  } catch { /* An incomplete or unsupported URL is handled by the existing API. */ }
  return null;
}

export function rankingPlayerDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value : null;
}

export function rankingEmbedUrl(remote: RankingRemote) {
  if (remote.platform === "youtube" && /^[\w-]{11}$/.test(remote.videoId))
    return `https://www.youtube.com/embed/${remote.videoId}`;
  if (remote.platform === "tiktok" && /^\d{10,25}$/.test(remote.videoId))
    return `https://www.tiktok.com/player/v1/${remote.videoId}?rel=0`;
  if (remote.platform === "instagram" && /^[\w-]{5,80}$/.test(remote.videoId))
    return `https://www.instagram.com/reel/${remote.videoId}/embed/`;
  throw new Error("지원하지 않는 플레이어 주소입니다.");
}

export function rankingTikTokMessage(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  frame: Window | null,
) {
  if (
    !frame ||
    event.source !== frame ||
    event.origin !== "https://www.tiktok.com"
  )
    return null;
  const data = event.data;
  if (!data || typeof data !== "object" || data["x-tiktok-player"] !== true)
    return null;
  if (data.type === "onCurrentTime") {
    const time = data.value?.currentTime;
    const duration = rankingPlayerDuration(data.value?.duration);
    return typeof time === "number" && Number.isFinite(time) && time >= 0
      ? { type: "time" as const, time, ...(duration === null ? {} : { duration }) }
      : null;
  }
  if (data.type === "onPlayerReady") return { type: "ready" as const };
  if (data.type === "onStateChange" && [0, 1, 2, 3].includes(data.value))
    return { type: "state" as const, state: data.value as number };
  if (data.type === "onPlayerError") return { type: "error" as const };
  return null;
}

export function rankingInstagramHeight(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  frame: Window | null,
) {
  if (
    !frame ||
    event.source !== frame ||
    event.origin !== "https://www.instagram.com"
  )
    return null;
  try {
    const data =
      typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    const height = data?.details?.height;
    return data?.type === "MEASURE" &&
      typeof height === "number" &&
      Number.isFinite(height) &&
      height >= 200 &&
      height <= 2000
      ? Math.ceil(height)
      : null;
  } catch {
    return null;
  }
}
