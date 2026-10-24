import { describe, expect, it } from "vitest";
import {
  rankingEmbedUrl,
  rankingDirectRemote,
  rankingPlayerDuration,
  rankingInstagramHeight,
  rankingTikTokMessage,
} from "./ranking-embed";

describe("ranking external playback", () => {
  it("accepts bounded Instagram height measurements only from its own frame", () => {
    const frame = {} as Window;
    const event = {
      origin: "https://www.instagram.com",
      source: frame,
      data: JSON.stringify({ type: "MEASURE", details: { height: 633.5 } }),
    };
    expect(rankingInstagramHeight(event, frame)).toBe(634);
    expect(
      rankingInstagramHeight({ ...event, origin: "https://evil.test" }, frame),
    ).toBeNull();
    expect(
      rankingInstagramHeight({ ...event, source: {} as Window }, frame),
    ).toBeNull();
    for (const data of [
      "bad JSON",
      null,
      { type: "MEASURE", details: { height: 100000 } },
      { type: "MEASURE", details: { height: NaN } },
    ]) {
      expect(rankingInstagramHeight({ ...event, data }, frame)).toBeNull();
    }
  });
  it("builds allowlisted player URLs and rejects injected identifiers", () => {
    expect(
      rankingEmbedUrl({ platform: "youtube", videoId: "abcdefghijk", url: "" }),
    ).toBe("https://www.youtube.com/embed/abcdefghijk");
    expect(
      rankingEmbedUrl({
        platform: "instagram",
        videoId: "ABCDEFG123",
        url: "",
      }),
    ).toBe("https://www.instagram.com/reel/ABCDEFG123/embed/");
    expect(() =>
      rankingEmbedUrl({ platform: "youtube", videoId: "../../evil", url: "" }),
    ).toThrow();
  });
  it("only accepts valid playback messages from the actual TikTok frame", () => {
    const frame = {} as Window;
    const event = {
      origin: "https://www.tiktok.com",
      source: frame,
      data: {
        "x-tiktok-player": true,
        type: "onCurrentTime",
        value: { currentTime: 3.5 },
      },
    };
    expect(rankingTikTokMessage(event, frame)).toEqual({
      type: "time",
      time: 3.5,
    });
    expect(
      rankingTikTokMessage({ ...event, origin: "https://evil.test" }, frame),
    ).toBeNull();
    expect(
      rankingTikTokMessage({ ...event, source: {} as Window }, frame),
    ).toBeNull();
    expect(
      rankingTikTokMessage(
        { ...event, data: { ...event.data, value: { currentTime: NaN } } },
        frame,
      ),
    ).toBeNull();
    expect(
      rankingTikTokMessage(
        { ...event, data: { ...event.data, value: { currentTime: -1 } } },
        frame,
      ),
    ).toBeNull();
  });
});


describe("direct ranking links", () => {
  it.each([
    "https://www.youtube.com/shorts/vtQV5zRU71o?si=share",
    "https://youtu.be/vtQV5zRU71o?t=4",
    "https://m.youtube.com/watch?v=vtQV5zRU71o",
    "https://youtube.com/embed/vtQV5zRU71o",
  ])("extracts a public YouTube ID without a server lookup: %s", (url) => {
    expect(rankingDirectRemote(url)).toEqual({platform: "youtube", videoId: "vtQV5zRU71o", url: "https://www.youtube.com/watch?v=vtQV5zRU71o"});
  });
  it("keeps the TikTok creator and video ID, stripping tracking parameters", () => {
    expect(rankingDirectRemote("https://www.tiktok.com/@creator.name/video/7123456789012345678?is_from_webapp=1"))
      .toEqual({platform: "tiktok", videoId: "7123456789012345678", url: "https://www.tiktok.com/@creator.name/video/7123456789012345678"});
  });
  it.each([
    "https://vm.tiktok.com/short/", "https://www.instagram.com/reel/abcdefg/",
    "https://youtube.com.evil.test/shorts/vtQV5zRU71o",
    "https://evil@youtube.com/shorts/vtQV5zRU71o", "http://youtube.com/shorts/vtQV5zRU71o",
    "https://youtube.com:8080/shorts/vtQV5zRU71o", "https://youtube.com/shorts/invalid",
    "https://www.tiktok.com/@creator/video/not-a-video", "not a URL",
  ])("does not construct a direct player for %s", (url) => {
    expect(rankingDirectRemote(url)).toBeNull();
  });
  it("ignores invalid or absent durations without inventing a source length", () => {
    for (const value of [undefined, null, "20", NaN, Infinity, 0, -1])
      expect(rankingPlayerDuration(value)).toBeNull();
    expect(rankingPlayerDuration(20.082)).toBe(20.082);
  });
  it("reads duration only from the actual TikTok player frame", () => {
    const frame = {} as Window;
    const event = {origin: "https://www.tiktok.com", source: frame, data: {
      "x-tiktok-player": true, type: "onCurrentTime", value: {currentTime: 1, duration: 43},
    }};
    expect(rankingTikTokMessage(event, frame)).toEqual({type: "time", time: 1, duration: 43});
    expect(rankingTikTokMessage({...event, source: {} as Window}, frame)).toBeNull();
    expect(rankingTikTokMessage({...event, origin: "https://evil.test"}, frame)).toBeNull();
  });
});
