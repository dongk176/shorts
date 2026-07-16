import type { YoutubeCreationBlockCode } from "@/lib/contracts";

type PlaybackAvailability = {
  creationAllowed: boolean;
  creationBlockCode: YoutubeCreationBlockCode | null;
  creationBlockReason: string | null;
};

type UnknownRecord = Record<string, unknown>;

const PLAYER_RESPONSE_MARKERS = [
  "ytInitialPlayerResponse = ",
  "var ytInitialPlayerResponse = ",
] as const;

const BOT_CHALLENGE_MARKERS = [
  "sign in to confirm you’re not a bot",
  "sign in to confirm you're not a bot",
] as const;

function blocked(
  creationBlockCode: YoutubeCreationBlockCode,
  creationBlockReason: string,
): PlaybackAvailability {
  return { creationAllowed: false, creationBlockCode, creationBlockReason };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsAny(value: string, markers: readonly string[]) {
  return markers.some((marker) => value.includes(marker));
}

function extractJsonObject(source: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error("YouTube 실제 재생 정보를 해석하지 못했습니다.");
}

export function parseInitialPlayerResponse(html: string): UnknownRecord {
  for (const marker of PLAYER_RESPONSE_MARKERS) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;
    const objectStart = html.indexOf("{", markerIndex + marker.length);
    if (objectStart < 0) continue;
    const parsed: unknown = JSON.parse(extractJsonObject(html, objectStart));
    if (isRecord(parsed)) return parsed;
  }
  throw new Error("YouTube 실제 재생 정보를 확인하지 못했습니다.");
}

function hasDrmMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDrmMarker);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.includes("drm")
      || normalizedKey === "licenseinfos"
      || normalizedKey === "licenseinfo"
    ) return true;
    return hasDrmMarker(nested);
  });
}

function formatHasLocator(value: unknown) {
  return isRecord(value) && ["url", "signatureCipher", "cipher"].some(
    (key) => typeof value[key] === "string" && value[key].length > 0,
  );
}

function playbackFormats(streamingData: UnknownRecord) {
  return [streamingData.formats, streamingData.adaptiveFormats]
    .flatMap((value) => Array.isArray(value) ? value : []);
}

function hasOnlyDrmFormats(streamingData: UnknownRecord) {
  const formats = playbackFormats(streamingData);
  const drmDetected = hasDrmMarker(streamingData);
  if (!drmDetected) return false;
  return !formats.some((format) => formatHasLocator(format) && !hasDrmMarker(format));
}

export function classifyYoutubePlaybackResponse(
  playerResponse: UnknownRecord,
): PlaybackAvailability {
  const playability = isRecord(playerResponse.playabilityStatus)
    ? playerResponse.playabilityStatus
    : {};
  const status = String(playability.status || "").toUpperCase();
  const reasonText = JSON.stringify(playability).toLowerCase();

  if (containsAny(reasonText, BOT_CHALLENGE_MARKERS)) {
    return blocked(
      "availability_unverified",
      "YouTube가 링크 검증 요청을 일시적으로 제한했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
  if (containsAny(reasonText, ["playercaptchaviewmodel", "captcha challenge"])) {
    return blocked(
      "availability_unverified",
      "YouTube가 링크 검증 요청에 추가 확인을 요구했습니다. 잠시 후 다시 확인해 주세요.",
    );
  }
  if (containsAny(reasonText, ["private video", "video is private"])) {
    return blocked("not_public", "비공개 영상은 쇼츠로 만들 수 없습니다.");
  }
  if (containsAny(reasonText, ["copyright", "copyright claim", "copyright grounds"])) {
    return blocked(
      "copyright_restricted",
      "저작권 제한으로 재생이 중단된 영상은 쇼츠로 만들 수 없습니다.",
    );
  }
  if (containsAny(reasonText, [
    "has been removed",
    "removed by the uploader",
    "uploader has closed",
    "account associated with this video has been terminated",
    "no longer available",
    "isn't available anymore",
    "is not available anymore",
    "has been deleted",
  ])) {
    return blocked("removed", "삭제되었거나 게시가 중단된 영상은 쇼츠로 만들 수 없습니다.");
  }
  if (containsAny(reasonText, [
    "members-only",
    "members only",
    "join this channel",
    "channel members",
  ])) {
    return blocked("members_only", "채널 멤버십 전용 영상은 쇼츠로 만들 수 없습니다.");
  }
  if (containsAny(reasonText, [
    "purchase this content",
    "paid content",
    "rent this",
    "buy this",
    "purchase required",
  ]) || reasonText.includes("ypctrailerrenderer")) {
    return blocked("paid_content", "구매 또는 대여가 필요한 영상은 쇼츠로 만들 수 없습니다.");
  }
  if (containsAny(reasonText, [
    "age-restricted",
    "age restricted",
    "confirm your age",
    "inappropriate for some users",
  ]) || status === "AGE_CHECK_REQUIRED" || status === "AGE_VERIFICATION_REQUIRED") {
    return blocked("age_restricted", "연령 확인이 필요한 영상은 쇼츠로 만들 수 없습니다.");
  }
  if (containsAny(reasonText, [
    "not available in your country",
    "not available in your region",
    "not available in this country",
  ])) {
    return blocked("region_restricted", "국가별 시청 제한이 있는 영상은 쇼츠로 만들 수 없습니다.");
  }
  if (containsAny(reasonText, [
    "premiere will begin",
    "live event will begin",
    "scheduled to begin",
    "upcoming event",
  ]) || status === "LIVE_STREAM_OFFLINE") {
    return blocked("not_yet_available", "아직 공개 또는 재생이 시작되지 않은 영상입니다.");
  }
  if (containsAny(reasonText, [
    "sign in to watch",
    "login required",
    "confirm your identity",
    "verify it’s you",
    "verify it's you",
  ]) || status === "LOGIN_REQUIRED") {
    return blocked(
      "authentication_required",
      "로그인 또는 계정 인증이 필요한 영상은 쇼츠로 만들 수 없습니다.",
    );
  }
  if (containsAny(reasonText, ["drm protected", "drm-protected"])) {
    return blocked("drm_protected", "DRM으로 보호된 영상은 쇼츠로 만들 수 없습니다.");
  }
  if (status !== "OK") {
    if (containsAny(reasonText, ["video unavailable", "unavailable video"])) {
      return blocked("playback_unavailable", "현재 재생할 수 없는 영상은 쇼츠로 만들 수 없습니다.");
    }
    return blocked(
      "availability_unverified",
      "YouTube 실제 재생 가능 여부를 확인할 수 없어 쇼츠를 만들 수 없습니다.",
    );
  }
  if (playability.playableInEmbed === false) {
    return blocked("embedding_disabled", "외부 재생이 제한된 영상은 쇼츠로 만들 수 없습니다.");
  }

  const streamingData = isRecord(playerResponse.streamingData)
    ? playerResponse.streamingData
    : null;
  if (!streamingData) {
    return blocked(
      "playback_unavailable",
      "재생 가능한 영상 포맷을 확인할 수 없어 쇼츠를 만들 수 없습니다.",
    );
  }
  if (hasOnlyDrmFormats(streamingData)) {
    return blocked("drm_protected", "DRM으로 보호된 영상은 쇼츠로 만들 수 없습니다.");
  }
  const hasPlaybackLocator = playbackFormats(streamingData).some(formatHasLocator)
    || (typeof streamingData.serverAbrStreamingUrl === "string"
      && streamingData.serverAbrStreamingUrl.length > 0);
  if (!hasPlaybackLocator) {
    return blocked(
      "playback_unavailable",
      "재생 가능한 영상 포맷을 확인할 수 없어 쇼츠를 만들 수 없습니다.",
    );
  }

  return { creationAllowed: true, creationBlockCode: null, creationBlockReason: null };
}

export async function verifyYoutubePlaybackAvailability(
  videoId: string,
): Promise<PlaybackAvailability> {
  const endpoint = new URL("https://www.youtube.com/watch");
  endpoint.searchParams.set("v", videoId);
  endpoint.searchParams.set("hl", "en");
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: {
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        + "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error("YouTube 실제 재생 가능 여부를 일시적으로 확인하지 못했습니다.");
  }
  const html = await response.text();
  if (html.length > 4_000_000) {
    throw new Error("YouTube 실제 재생 응답이 허용된 크기를 초과했습니다.");
  }
  return classifyYoutubePlaybackResponse(parseInitialPlayerResponse(html));
}
