import { describe, expect, it } from "vitest";
import { youtubePrivacyEnhancedEmbedUrl } from "./youtube-embed";

describe("youtubePrivacyEnhancedEmbedUrl", () => {
  it("uses the privacy-enhanced YouTube player for a valid video id", () => {
    expect(youtubePrivacyEnhancedEmbedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1",
    );
  });

  it("rejects malformed ids instead of constructing an iframe URL", () => {
    expect(youtubePrivacyEnhancedEmbedUrl("https://bad.example")).toBeNull();
    expect(youtubePrivacyEnhancedEmbedUrl("too-short")).toBeNull();
  });
});
