import { describe, expect, it } from "vitest";
import { normalizeApplicationChannels } from "@/lib/creator-application";

describe("creator application channel links", () => {
  it("accepts YouTube on its own", () => {
    expect(normalizeApplicationChannels({ youtube: "youtube.com/@creator", instagram: "" }))
      .toEqual([{ platform: "youtube", channelUrl: "https://youtube.com/@creator" }]);
  });
  it("accepts Instagram on its own without a YouTube channel or display name", () => {
    expect(normalizeApplicationChannels({ youtube: " ", instagram: "instagram.com/creator" }))
      .toEqual([{ platform: "instagram", channelUrl: "https://instagram.com/creator" }]);
  });
  it("retains both platforms together", () => {
    expect(normalizeApplicationChannels({ youtube: "youtube.com/@creator", instagram: "instagram.com/creator" }))
      .toEqual([
        { platform: "youtube", channelUrl: "https://youtube.com/@creator" },
        { platform: "instagram", channelUrl: "https://instagram.com/creator" },
      ]);
  });
  it("requires at least one link", () => {
    expect(() => normalizeApplicationChannels({ youtube: "", instagram: " " })).toThrow("하나 이상");
  });
  it("does not silently drop an invalid second link", () => {
    expect(() => normalizeApplicationChannels({ youtube: "youtube.com/@creator", instagram: "youtube.com/@creator" })).toThrow();
  });
});
