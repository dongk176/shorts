import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./youtube-quota", () => ({ catalogReadsEnabled: vi.fn() }));
vi.mock("./youtube-catalog", () => ({ getCatalogVideos: vi.fn() }));
vi.mock("./youtube-popular", () => ({ getPopularVideos: vi.fn() }));
import { catalogReadsEnabled } from "./youtube-quota";
import { getCatalogVideos } from "./youtube-catalog";
import { getPopularVideos } from "./youtube-popular";
import { publicPopularVideos } from "./public-popular-videos";
beforeEach(() => vi.resetAllMocks());
describe("public popular server snapshot", () => {
  it("uses only the anonymous unfiltered first page", async () => {
    vi.mocked(catalogReadsEnabled).mockReturnValue(true);
    vi.mocked(getCatalogVideos).mockResolvedValue({ items: [], updatedAt: "2026-10-01" });
    await publicPopularVideos();
    expect(getCatalogVideos).toHaveBeenCalledWith({ type: "trending", category: "all", reusable: false, longForm: false, korean: false, japanese: false, english: false, period: "all" });
    expect(getPopularVideos).not.toHaveBeenCalled();
  });
  it("preserves the legacy catalogue gate", async () => {
    vi.mocked(catalogReadsEnabled).mockReturnValue(false);
    await publicPopularVideos();
    expect(getPopularVideos).toHaveBeenCalledWith("trending", "all", false, false, false);
    expect(getCatalogVideos).not.toHaveBeenCalled();
  });
  it("allows a client retry after a temporary failure", async () => {
    vi.mocked(catalogReadsEnabled).mockReturnValue(true);
    vi.mocked(getCatalogVideos).mockRejectedValue(new Error("unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await publicPopularVideos()).toBeNull();
    warning.mockRestore();
  });
});
