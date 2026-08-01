import { describe, expect, it } from "vitest";
import { editorChannelAssetPreviewUrl } from "@/lib/editor-channel-asset-url";

describe("editor channel asset preview URL", () => {
  it("returns the authenticated editor asset route with a render-version cache key", () => {
    expect(editorChannelAssetPreviewUrl("short/id", 7)).toBe(
      "/api/shorts/short%2Fid/editor-channel-asset?renderVersion=7",
    );
  });
});
