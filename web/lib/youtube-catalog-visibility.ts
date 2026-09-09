import type { PopularVideo, PopularVideoType } from "@/lib/youtube-popular";

export type CatalogVisibility = {
  videoId: string;
  available: boolean;
  license: "youtube" | "creativeCommon" | null;
  recentTrending: boolean;
  currentTrending: boolean;
};

/** Refresh safety-critical fields without inserting or reordering visible cards. */
export function reconcileCatalogVisibility(
  items: PopularVideo[],
  statuses: CatalogVisibility[],
  filters: {
    type: PopularVideoType;
    reusable: boolean;
    date: string | null;
    delayed: boolean;
  },
) {
  const byId = new Map(statuses.map((status) => [status.videoId, status]));
  return items.flatMap((video) => {
    const status = byId.get(video.videoId);
    if (status) {
      if (!status.available) return [];
      if (
        filters.type === "trending" &&
        !filters.date &&
        !status.recentTrending
      )
        return [];
      if (
        (filters.type === "reusable" || filters.reusable) &&
        status.license !== "creativeCommon"
      )
        return [];
      if (
        filters.type === "views" &&
        !filters.reusable &&
        status.license !== "youtube"
      )
        return [];
    }
    const license = status?.license || video.license;
    const isCurrentTrending =
      filters.delayed || filters.type !== "trending" || filters.date
        ? false
        : (status?.currentTrending ?? video.isCurrentTrending);
    return [{ ...video, license, isCurrentTrending }];
  });
}
