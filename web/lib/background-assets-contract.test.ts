import { describe, expect, it } from "vitest";
import { backgroundAssetImageUrl, collectBackgroundAssetIds } from "@/lib/background-assets-contract";

const ID = "710489ee-7318-48a1-b4d1-73573f3654ab";
const background = { kind: "uploaded_image", assetId: ID };

describe("background asset reference contract", () => {
  it.each([
    background,
    { background },
    { config: { background } },
    { overlays: { background } },
    { template: { snapshot: { config: { background } } } },
  ])("collects only supported background positions", (value) => {
    expect(collectBackgroundAssetIds(value)).toEqual([ID]);
  });

  it("normalizes and deduplicates identifiers without searching arbitrary content", () => {
    expect(collectBackgroundAssetIds({
      background,
      config: { background: { ...background, assetId: ID.toUpperCase() } },
      textOverlays: [{ text: ID, background: { kind: "uploaded_image", assetId: "invalid" } }],
    })).toEqual([ID]);
    expect(collectBackgroundAssetIds({ nested: { background } })).toEqual([]);
  });

  it.each([null, [], {}, { background: { kind: "color", color: "#000000" } }, { config: {} }])(
    "does not add asset references to old configurations", (value) => {
      expect(collectBackgroundAssetIds(value)).toEqual([]);
    },
  );

  it("fails closed for malformed new-format references", () => {
    expect(() => collectBackgroundAssetIds({ background: { kind: "uploaded_image", assetId: "../../other" } })).toThrow();
    expect(() => collectBackgroundAssetIds({ background: { kind: "uploaded_image" } })).toThrow();
  });

  it("only produces a same-origin item URL from a UUID", () => {
    expect(backgroundAssetImageUrl(ID)).toBe(`/api/background-assets/${ID}`);
    expect(() => backgroundAssetImageUrl("https://example.com/image.webp")).toThrow();
  });
});
