import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedRankingRequest, rankingRenderSchema } from "./ranking-shorts";

const sourceId = "193a3540-3366-4526-94be-030a34293344";
const clip = { rank: 1, sourceId, label: "장면", start: 1, end: 4 };
const spec = { title: "랭킹", descending: true, clips: [clip] };
afterEach(() => vi.unstubAllEnvs());

describe("ranking local boundary", () => {
  it("stays closed in production even when the test flag is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_RANKING_SHORTS_TEST", "1");
    expect(
      allowedRankingRequest(
        new Request("http://localhost:3200/api/ranking-shorts"),
      ),
    ).toBe(false);
  });
  it("requires opt-in and a same-origin loopback request", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_RANKING_SHORTS_TEST", "0");
    expect(allowedRankingRequest(new Request("http://localhost:3200"))).toBe(
      false,
    );
    vi.stubEnv("NEXT_PUBLIC_RANKING_SHORTS_TEST", "1");
    expect(allowedRankingRequest(new Request("http://localhost:3200"))).toBe(
      true,
    );
    expect(
      allowedRankingRequest(
        new Request("http://localhost:3200", {
          headers: {
            host: "127.0.0.1:3200",
            origin: "http://127.0.0.1:3200",
          },
        }),
      ),
    ).toBe(true);
    expect(
      allowedRankingRequest(new Request("https://www.easycut.co.kr")),
    ).toBe(false);
    expect(
      allowedRankingRequest(
        new Request("http://localhost:3200", {
          headers: { origin: "https://evil.test" },
        }),
      ),
    ).toBe(false);
    expect(
      allowedRankingRequest(
        new Request("http://localhost:3200", {
          headers: { origin: "http://localhost:9000" },
        }),
      ),
    ).toBe(false);
    expect(
      allowedRankingRequest(
        new Request("http://localhost:3200", {
          headers: { "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toBe(false);
    expect(
      allowedRankingRequest(
        new Request("http://localhost:3200", {
          headers: { host: "evil.test" },
        }),
      ),
    ).toBe(false);
  });
});

describe("ranking render admission", () => {
  it("accepts sub-three-minute sources without changing the longform contract", () => {
    expect(rankingRenderSchema.safeParse(spec).success).toBe(true);
  });
  it.each([
    { ...clip, start: 5, end: 4 },
    { ...clip, end: 1.1 },
    { ...clip, end: 62 },
    { ...clip, start: -1 },
    { ...clip, end: Infinity },
    { ...clip, sourceId: "../../secrets" },
    { ...clip, rank: 2 },
  ])(
    "rejects invalid ranges, source identifiers and missing ranks",
    (invalid) => {
      expect(
        rankingRenderSchema.safeParse({ ...spec, clips: [invalid] }).success,
      ).toBe(false);
    },
  );
  it("rejects repeated ranks and total duration over 180 seconds", () => {
    expect(
      rankingRenderSchema.safeParse({ ...spec, clips: [clip, clip] }).success,
    ).toBe(false);
    expect(
      rankingRenderSchema.safeParse({
        ...spec,
        clips: [1, 2, 3, 4].map((rank) => ({
          ...clip,
          rank,
          start: 0,
          end: 60,
        })),
      }).success,
    ).toBe(false);
  });
});

it("accepts a separate second headline and rejects oversized subtitles", () => {
  expect(
    rankingRenderSchema.parse({ ...spec, subtitle: " 랭킹 갓 " }).subtitle,
  ).toBe("랭킹 갓");
  expect(rankingRenderSchema.parse(spec).subtitle).toBe("랭킹");
  expect(
    rankingRenderSchema.safeParse({ ...spec, subtitle: "가".repeat(61) })
      .success,
  ).toBe(false);
});

it("accepts curated template overrides and rejects arbitrary font paths", () => {
  const style = {
    template: "impact",
    font: "jua",
    palette: "mint",
    position: "left",
  };
  expect(rankingRenderSchema.parse({ ...spec, style }).style).toEqual(style);
  expect(rankingRenderSchema.parse(spec).style.position).toBe("left");
  expect(
    rankingRenderSchema.safeParse({
      ...spec,
      style: { ...style, font: "../../secret" },
    }).success,
  ).toBe(false);
  expect(
    rankingRenderSchema.safeParse({
      ...spec,
      style: { ...style, position: "outside" },
    }).success,
  ).toBe(false);
});

it("renders only populated ranks while preserving the chosen rank count", () => {
  expect(
    rankingRenderSchema.safeParse({
      ...spec,
      rankCount: 10,
      clips: [
        { ...clip, rank: 4 },
        { ...clip, rank: 10 },
      ],
    }).success,
  ).toBe(true);
  expect(
    rankingRenderSchema.safeParse({
      ...spec,
      rankCount: 10,
      clips: [{ ...clip, rank: 10 }],
    }).success,
  ).toBe(true);
  expect(
    rankingRenderSchema.safeParse({
      ...spec,
      rankCount: 3,
      clips: [{ ...clip, rank: 4 }],
    }).success,
  ).toBe(false);
  expect(
    rankingRenderSchema.safeParse({ ...spec, rankCount: 10, clips: [] })
      .success,
  ).toBe(false);
  expect(
    rankingRenderSchema.safeParse({
      ...spec,
      rankCount: 10,
      clips: [clip, clip],
    }).success,
  ).toBe(false);
});

it("accepts independent title colors and rejects non-hex paint values", () => {
  const style = {
    template: "classic",
    font: "jua",
    palette: "gold",
    position: "left",
    titleColor: "#123abc",
    subtitleColor: "#ff00aa",
    accentColor: "#12FF09",
  };
  expect(rankingRenderSchema.parse({ ...spec, style }).style).toEqual(style);
  expect(
    rankingRenderSchema.safeParse({
      ...spec,
      style: { ...style, titleColor: "url(file:///etc/passwd)" },
    }).success,
  ).toBe(false);
});
