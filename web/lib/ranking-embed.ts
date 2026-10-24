import type { RankingRemote } from "./ranking-shorts";

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
    return typeof time === "number" && Number.isFinite(time) && time >= 0
      ? { type: "time" as const, time }
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
