import { z } from "zod";
import { expectedShortCount, type YoutubeCreationBlockCode } from "@/lib/contracts";
import { verifyYoutubePlaybackAvailability } from "@/lib/youtube-playback";

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
    const thumbnails = Object.values(parsed.items[0]?.snippet.thumbnails || {});
    return thumbnails.at(-1)?.url || thumbnails[0]?.url || null;
  } catch {
    return null;
  }
}

type CreationAvailability = {
  creationAllowed: boolean;
  creationBlockCode: YoutubeCreationBlockCode | null;
  creationBlockReason: string | null;
};

export function getYoutubeCreationAvailability(
  item: z.infer<typeof responseSchema>["items"][number],
): CreationAvailability {
  const restriction = item.contentDetails.regionRestriction;
  if (restriction?.allowed !== undefined || (restriction?.blocked?.length || 0) > 0) {
    return {
      creationAllowed: false,
      creationBlockCode: "region_restricted",
      creationBlockReason: "이 영상은 국가별 시청이 제한된 영상입니다.",
    };
  }
  if (item.contentDetails.contentRating?.ytRating === "ytAgeRestricted") {
    return {
      creationAllowed: false,
      creationBlockCode: "age_restricted",
      creationBlockReason: "이 영상은 연령 제한이 적용된 영상입니다.",
    };
  }
  if (!item.status) {
    return {
      creationAllowed: false,
      creationBlockCode: "availability_unverified",
      creationBlockReason: "이 영상은 공개 상태를 확인할 수 없는 영상입니다.",
    };
  }
  if (item.status.publishAt && Date.parse(item.status.publishAt) > Date.now()) {
    return {
      creationAllowed: false,
      creationBlockCode: "not_yet_available",
      creationBlockReason: "이 영상은 아직 예약 공개 시간이 되지 않은 영상입니다.",
    };
  }
  if (item.status.privacyStatus !== "public") {
    return {
      creationAllowed: false,
      creationBlockCode: "not_public",
      creationBlockReason: "이 영상은 전체 공개가 아닌 영상입니다.",
    };
  }
  if (item.status.uploadStatus !== "processed") {
    if (item.status.uploadStatus === "deleted") {
      return {
        creationAllowed: false,
        creationBlockCode: "removed",
        creationBlockReason: "이 영상은 삭제되었거나 게시가 중단된 영상입니다.",
      };
    }
    if (item.status.rejectionReason === "copyright") {
      return {
        creationAllowed: false,
        creationBlockCode: "copyright_restricted",
        creationBlockReason: "이 영상은 저작권 문제로 재생이 제한된 영상입니다.",
      };
    }
    return {
      creationAllowed: false,
      creationBlockCode: "not_processed",
      creationBlockReason: "이 영상은 YouTube 처리가 아직 완료되지 않은 영상입니다.",
    };
  }
  if (
    item.liveStreamingDetails?.scheduledStartTime
    && !item.liveStreamingDetails.actualStartTime
  ) {
    return {
      creationAllowed: false,
      creationBlockCode: "not_yet_available",
      creationBlockReason: "이 영상은 아직 공개 또는 재생이 시작되지 않은 영상입니다.",
    };
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
    const playback = await verifyYoutubePlaybackAvailability(videoId);
    throw new Error(
      playback.creationBlockReason || "비공개, 삭제 또는 이용이 중단된 영상입니다.",
    );
  }
  const durationSeconds = parseIsoDuration(item.contentDetails.duration);
  if (durationSeconds <= 0 || durationSeconds > 3600) throw new Error("최대 60분 길이의 영상까지만 만들 수 있습니다.");
  const thumbnails = Object.values(item.snippet.thumbnails);
  const metadataAvailability = getYoutubeCreationAvailability(item);
  const playbackAvailability = metadataAvailability.creationAllowed
    ? await verifyYoutubePlaybackAvailability(videoId)
    : metadataAvailability;
  const availability = playbackAvailability.creationBlockCode === "bot_challenge"
    ? { creationAllowed: true, creationBlockCode: null, creationBlockReason: null }
    : playbackAvailability;
  const channelThumbnailUrl = await getChannelThumbnailUrl(item.snippet.channelId, apiKey);
  return {
    videoId,
    normalizedUrl,
    title: item.snippet.title,
    channelName: Array.from(item.snippet.channelTitle.trim()).slice(0, 50).join("") || "YouTube 채널",
    channelThumbnailUrl,
    thumbnailUrl: thumbnails.at(-1)?.url || thumbnails[0]?.url || "",
    durationSeconds,
    expectedShortCount: expectedShortCount(durationSeconds),
    ...availability,
  };
}
