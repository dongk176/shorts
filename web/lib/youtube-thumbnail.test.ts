import { describe, expect, it } from "vitest";

import {
  normalizeYoutubeThumbnailUrl,
  selectYoutubeThumbnail,
  youtubeThumbnailFallbackUrl,
} from "./youtube-thumbnail";

describe("YouTube thumbnail selection", () => {
  it("ignores experimental high-resolution entries even when they are appended last", () => {
    expect(selectYoutubeThumbnail({
      default: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg" },
      high: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" },
      maxres: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg" },
      fhd: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/fhddefault.jpg" },
      qhd: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/qhddefault.jpg" },
    })).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
  });

  it.each(["fhd", "qhd", "uhd"])("repairs a persisted %s thumbnail", (quality) => {
    expect(normalizeYoutubeThumbnailUrl(
      `https://i.ytimg.com/vi/dQw4w9WgXcQ/${quality}default.jpg`,
    )).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
  });

  it("falls back to the reliable hq thumbnail for trusted YouTube URLs", () => {
    expect(youtubeThumbnailFallbackUrl(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    )).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });

  it("does not rewrite or derive fallbacks for untrusted hosts", () => {
    const input = "https://example.com/vi/dQw4w9WgXcQ/fhddefault.jpg";
    expect(normalizeYoutubeThumbnailUrl(input)).toBe(input);
    expect(youtubeThumbnailFallbackUrl(input)).toBeNull();
  });
});
