import { z } from "zod";
import { expectedShortCount, type YoutubeCreationBlockCode } from "@/lib/contracts";
import { assertSupportedSourceVideoDuration } from "@/lib/source-video";
import { selectYoutubeThumbnail } from "@/lib/youtube-thumbnail";

const youtubeId = /^[A-Za-z0-9_-]{11}$/;
const UNAVAILABLE_VIDEO_MESSAGE = "유효하지 않거나 현재 시청할 수 없는 영상입니다 (비공개, 삭제, 또는 멤버십 전용)";

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

export function parseIsoDuration(value: string) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) throw new Error("영상 길이를 확인하지 못했습니다.");
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

const responseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    snippet: z.object({
      title: z.string(),
      channelTitle: z.string(),
      channelId: z.string().optional(),
      thumbnails: z.record(z.string(), z.object({ url: z.string().url() })),
    }),
    contentDetails: z.object({
      duration: z.string(),
      regionRestriction: z.object({
        allowed: z.array(z.string()).optional(),
        blocked: z.array(z.string()).optional(),
      }).optional(),
      contentRating: z.object({
        ytRating: z.string().optional(),
      }).optional(),
    }),
    status: z.object({
      uploadStatus: z.string(),
      privacyStatus: z.string(),
      embeddable: z.boolean(),
      failureReason: z.string().optional(),
      rejectionReason: z.string().optional(),
      publishAt: z.string().optional(),
    }).optional(),
    liveStreamingDetails: z.object({
      scheduledStartTime: z.string().optional(),
      actualStartTime: z.string().optional(),
      actualEndTime: z.string().optional(),
    }).optional(),
  })),
});

const channelResponseSchema = z.object({
  items: z.array(z.object({
    snippet: z.object({
      thumbnails: z.record(z.string(), z.object({ url: z.string().url() })),
    }),
  })),
});

async function getChannelThumbnailUrl(channelId: string | undefined, apiKey: string) {
  if (!channelId) return null;
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/channels");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("id", channelId);
  endpoint.searchParams.set("key", apiKey);
  try {
    const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const parsed = channelResponseSchema.parse(await response.json());
    const thumbnailUrl = selectYoutubeThumbnail(parsed.items[0]?.snippet.thumbnails || {});
    return thumbnailUrl || null;
  } catch {
    return null;
  }
}

type CreationAvailability = {
  creationAllowed: boolean;
  creationBlockCode: YoutubeCreationBlockCode | null;
  creationBlockReason: string | null;
};

function unavailable(creationBlockCode: YoutubeCreationBlockCode): CreationAvailability {
  return {
    creationAllowed: false,
    creationBlockCode,
    creationBlockReason: UNAVAILABLE_VIDEO_MESSAGE,
  };
}

export function getYoutubeCreationAvailability(
  item: z.infer<typeof responseSchema>["items"][number],
): CreationAvailability {
  const restriction = item.contentDetails.regionRestriction;
  if (restriction?.allowed !== undefined || (restriction?.blocked?.length || 0) > 0) {
    return unavailable("region_restricted");
  }
  if (item.contentDetails.contentRating?.ytRating === "ytAgeRestricted") {
    return unavailable("age_restricted");
  }
  if (!item.status) {
    return unavailable("availability_unverified");
  }
  if (item.status.publishAt && Date.parse(item.status.publishAt) > Date.now()) {
    return unavailable("not_yet_available");
  }
  if (item.status.privacyStatus !== "public") {
    return unavailable("not_public");
  }
  if (item.status.uploadStatus !== "processed") {
    if (item.status.uploadStatus === "deleted") {
      return unavailable("removed");
    }
    if (item.status.rejectionReason === "copyright") {
      return unavailable("copyright_restricted");
    }
    return unavailable("not_processed");
  }
  if (
    item.liveStreamingDetails?.scheduledStartTime
    && !item.liveStreamingDetails.actualStartTime
  ) {
    return unavailable("not_yet_available");
  }
  return {
    creationAllowed: true,
    creationBlockCode: null,
    creationBlockReason: null,
  };
}

export async function analyzeYoutubeUrl(input: string) {
  const { videoId, normalizedUrl } = normalizeYoutubeUrl(input);
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY가 설정되지 않았습니다.");
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "snippet,contentDetails,status,liveStreamingDetails");
  endpoint.searchParams.set("id", videoId);
  endpoint.searchParams.set("key", apiKey);
  const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("YouTube 영상 정보를 확인하지 못했습니다.");
  const parsed = responseSchema.parse(await response.json());
  const item = parsed.items[0];
  if (!item) {
    throw new Error(UNAVAILABLE_VIDEO_MESSAGE);
  }
  const durationSeconds = parseIsoDuration(item.contentDetails.duration);
  // The persisted release snapshot decides whether the legacy 60-minute cap
  // applies. Metadata extraction must accept longer sources so a bounded
  // range can be selected from them.
  assertSupportedSourceVideoDuration(durationSeconds, {
    sourceRangeSelectionEnabled: true,
  });
  const availability = getYoutubeCreationAvailability(item);
  const channelThumbnailUrl = await getChannelThumbnailUrl(item.snippet.channelId, apiKey);
  return {
    videoId,
    normalizedUrl,
    title: item.snippet.title,
    channelName: Array.from(item.snippet.channelTitle.trim()).slice(0, 50).join("") || "YouTube 채널",
    channelThumbnailUrl,
    thumbnailUrl: selectYoutubeThumbnail(item.snippet.thumbnails),
    durationSeconds,
    expectedShortCount: expectedShortCount(durationSeconds),
    ...availability,
  };
}
