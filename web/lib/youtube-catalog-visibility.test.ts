import { describe, expect, it } from "vitest";
import {
  reconcileCatalogVisibility,
  type CatalogVisibility,
} from "./youtube-catalog-visibility";
import type { PopularVideo } from "./youtube-popular";
const items = ["first000001", "second00001", "third000001"].map(
  (videoId) =>
    ({
      videoId,
      license: "creativeCommon",
      isCurrentTrending: true,
    }) as PopularVideo,
);
const status = (
  videoId: string,
  overrides: Partial<CatalogVisibility> = {},
): CatalogVisibility => ({
  videoId,
  available: true,
  license: "creativeCommon",
  recentTrending: true,
  currentTrending: true,
  ...overrides,
});
const filters = {
  type: "trending" as const,
  reusable: false,
  date: null,
  delayed: false,
};
describe("visible catalog safety updates", () => {
  it("keeps mixed-license search results while enforcing availability and an explicit CC filter", () => {
    const statuses=[status(items[0].videoId,{recentTrending:false}),status(items[1].videoId,{license:"youtube"}),status(items[2].videoId,{available:false})];
    const found=reconcileCatalogVisibility(items,statuses,{...filters,type:"views",searching:true});
    expect(found.map(v=>v.videoId)).toEqual([items[0].videoId,items[1].videoId]);
    expect(found.every(v=>!v.isCurrentTrending)).toBe(true);
    expect(reconcileCatalogVisibility(items,statuses,{...filters,type:"views",searching:true,reusable:true}).map(v=>v.videoId)).toEqual([items[0].videoId]);
  });
  it("removes unavailable cards and updates licenses without inserting or reordering videos", () => {
    const result = reconcileCatalogVisibility(
      items,
      [
        status(items[0].videoId, { available: false, license: null }),
        status(items[1].videoId, { license: "youtube" }),
        status("new00000001"),
      ],
      filters,
    );
    expect(result.map((item) => item.videoId)).toEqual([
      items[1].videoId,
      items[2].videoId,
    ]);
    expect(result[0].license).toBe("youtube");
  });
  it("enforces both cumulative license lists and preserves historical date membership", () => {
    const statuses = [
      status(items[0].videoId, { license: "youtube" }),
      status(items[1].videoId, { recentTrending: false }),
    ];
    expect(
      reconcileCatalogVisibility(items, statuses, {
        ...filters,
        type: "reusable",
      }).map((v) => v.videoId),
    ).toEqual([items[1].videoId, items[2].videoId]);
    expect(
      reconcileCatalogVisibility(items, statuses, filters).map(
        (v) => v.videoId,
      ),
    ).toEqual([items[0].videoId, items[2].videoId]);
    expect(
      reconcileCatalogVisibility(items, statuses, {
        ...filters,
        date: "2026-09-01",
      }),
    ).toHaveLength(3);
  });
  it("does not remove cards on a failed status request and suppresses stale trending badges", () => {
    const result = reconcileCatalogVisibility(items, [], {
      ...filters,
      delayed: true,
    });
    expect(result.map((v) => v.videoId)).toEqual(items.map((v) => v.videoId));
    expect(result.every((v) => v.isCurrentTrending === false)).toBe(true);
  });
  it("keeps previously collected CC cards after 24 hours while still removing changed licenses", () => {
    const result = reconcileCatalogVisibility(items, [
      status(items[0].videoId, { recentTrending: false, currentTrending: false }),
      status(items[1].videoId, { license: "youtube" }),
      status(items[2].videoId, { available: false }),
    ], { ...filters, reusable: true, periodBasis: "collected" });
    expect(result.map(v => v.videoId)).toEqual([items[0].videoId]);
    expect(result[0].isCurrentTrending).toBe(false);
  });
});
