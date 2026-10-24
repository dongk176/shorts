import { describe, expect, it } from "vitest";
import {
  rankingEmbedUrl,
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
