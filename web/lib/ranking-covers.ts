// Public image variants only; this never prepares or downloads source media.
export function rankingYoutubeCovers(videoId: string, portrait = false): string[] {
  if (!/^[\w-]{11}$/.test(videoId)) return [];
  const names = portrait
    ? ["oardefault.jpg", "oar2.jpg", "maxresdefault.jpg", "mqdefault.jpg"]
    : ["hqdefault.jpg"];
  return names.map(name => `https://i.ytimg.com/vi/${videoId}/${name}`);
}
