const YOUTUBE_THUMBNAIL_HOSTS = new Set(["i.ytimg.com", "img.youtube.com"]);
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

type Thumbnail = { url: string };

export function selectYoutubeThumbnail(thumbnails: Record<string, Thumbnail>) {
  for (const name of ["maxres", "standard", "high", "medium", "default"]) {
    const url = thumbnails[name]?.url;
    if (url) return url;
  }
  return "";
}

function youtubeThumbnailVideoId(input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || !YOUTUBE_THUMBNAIL_HOSTS.has(url.hostname)) return null;
    const match = /^\/vi\/([^/]+)\/[^/]+$/.exec(url.pathname);
    return match && YOUTUBE_VIDEO_ID.test(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

export function normalizeYoutubeThumbnailUrl(input: string) {
  const videoId = youtubeThumbnailVideoId(input);
  if (!videoId) return input;
  try {
    const url = new URL(input);
    if (!/^\/vi\/[^/]+\/(?:fhd|qhd|uhd)default\.jpg$/.test(url.pathname)) return input;
    return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  } catch {
    return input;
  }
}

export function youtubeThumbnailFallbackUrl(input: string) {
  const videoId = youtubeThumbnailVideoId(input);
  return videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}
