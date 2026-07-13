import { z } from "zod";
import { expectedShortCount } from "@/lib/contracts";

const youtubeId = /^[A-Za-z0-9_-]{11}$/;

export function normalizeYoutubeUrl(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("올바른 YouTube 링크를 입력해 주세요."); }
  if (url.protocol !== "https:") throw new Error("HTTPS YouTube 링크만 사용할 수 있습니다.");
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("인증 정보나 별도 포트가 포함된 주소는 사용할 수 없습니다.");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
  else if (["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
    else if (url.pathname.startsWith("/shorts/")) id = url.pathname.split("/")[2] || "";
  } else throw new Error("지원하지 않는 YouTube 주소입니다.");
  if (!youtubeId.test(id)) throw new Error("YouTube 영상 ID가 올바르지 않습니다.");
  return { videoId: id, normalizedUrl: `https://www.youtube.com/watch?v=${id}` };
}

function parseIsoDuration(value: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) throw new Error("영상 길이를 확인하지 못했습니다.");
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

const responseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    snippet: z.object({ title: z.string(), channelTitle: z.string(), thumbnails: z.record(z.string(), z.object({ url: z.string().url() })) }),
    contentDetails: z.object({ duration: z.string() }),
  })),
});

export async function analyzeYoutubeUrl(input: string) {
  const { videoId, normalizedUrl } = normalizeYoutubeUrl(input);
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY가 설정되지 않았습니다.");
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "snippet,contentDetails");
  endpoint.searchParams.set("id", videoId);
  endpoint.searchParams.set("key", apiKey);
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("YouTube 영상 정보를 확인하지 못했습니다.");
  const parsed = responseSchema.parse(await response.json());
  const item = parsed.items[0];
  if (!item) throw new Error("공개적으로 확인할 수 없는 영상입니다.");
  const durationSeconds = parseIsoDuration(item.contentDetails.duration);
  if (durationSeconds <= 0 || durationSeconds > 3600) throw new Error("최대 60분 길이의 영상까지만 만들 수 있습니다.");
  const thumbnails = Object.values(item.snippet.thumbnails);
  return {
    videoId,
    normalizedUrl,
    title: item.snippet.title,
    channelName: Array.from(item.snippet.channelTitle.trim()).slice(0, 50).join("") || "YouTube 채널",
    thumbnailUrl: thumbnails.at(-1)?.url || thumbnails[0]?.url || "",
    durationSeconds,
    expectedShortCount: expectedShortCount(durationSeconds),
  };
}
