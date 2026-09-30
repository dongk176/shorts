import "server-only";
import { catalogReadsEnabled } from "./youtube-quota";
import { getCatalogVideos } from "./youtube-catalog";
import { getPopularVideos, type PopularVideoResponse } from "./youtube-popular";

export async function publicPopularVideos(): Promise<PopularVideoResponse | null> {
  try {
    if (catalogReadsEnabled()) {
      return await getCatalogVideos({ type: "trending", category: "all", reusable: false, longForm: false, korean: false, japanese: false, english: false, period: "all" });
    }
    return await getPopularVideos("trending", "all", false, false, false);
  } catch (error) {
    // A temporary catalogue failure must not turn the landing page into a 500.
    console.warn("popular_initial_snapshot_unavailable", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}
