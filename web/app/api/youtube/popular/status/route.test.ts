import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  state: vi.fn(async () => ({ generation: "current" })),
  visibility: vi.fn(async () => []),
}));
vi.mock("@/lib/youtube-quota", () => ({ catalogReadsEnabled: mocks.enabled }));
vi.mock("@/lib/youtube-catalog", () => ({
  catalogStatus: mocks.state,
  getCatalogVisibility: mocks.visibility,
}));
import { GET } from "./route";
describe("catalog status requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled.mockReturnValue(true);
  });
  it("returns DB visibility checks with private cache controls", async () => {
    const response = await GET(
      new Request(
        "https://example.com/api/youtube/popular/status?type=reusable&ids=first000001,second00001",
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.visibility).toHaveBeenCalledWith([
      "first000001",
      "second00001",
    ]);
  });
  it.each([
    "ids=bad",
    "ids=" + Array(201).fill("first000001").join(","),
    "type=unsupported",
  ])("rejects unbounded or invalid input %s", async (query) => {
    expect(
      (
        await GET(
          new Request(
            "https://example.com/api/youtube/popular/status?" + query,
          ),
        )
      ).status,
    ).toBe(400);
    expect(mocks.state).not.toHaveBeenCalled();
    expect(mocks.visibility).not.toHaveBeenCalled();
  });
  it("does not query new tables when catalog reads are disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(
      await (
        await GET(new Request("https://example.com/api/youtube/popular/status"))
      ).json(),
    ).toEqual({ catalogEnabled: false });
    expect(mocks.state).not.toHaveBeenCalled();
  });
});
