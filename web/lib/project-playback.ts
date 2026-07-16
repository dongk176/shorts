import type { GeneratedShort } from "@/lib/contracts";

type PlaybackShort = Pick<GeneratedShort, "id" | "renderVersion" | "status">;

export function isPlaybackAvailable(item: PlaybackShort) {
  return item.status === "ready" || item.status === "rerendering";
}

export function shortPlaybackVersionKey(item: Pick<PlaybackShort, "id" | "renderVersion">) {
  return JSON.stringify([item.id, item.renderVersion]);
}
