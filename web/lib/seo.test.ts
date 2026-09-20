import { describe, expect, it } from "vitest";
import { createPageMetadata } from "./seo";

describe("localized share cards", () => {
  it.each([
    ["ko", "/", "/easy-cut-og-1200x630-v3.jpg"],
    ["en", "/en", "/easycut-og-en-v1.jpg"],
    ["ja", "/jp", "/easycut-og-ja-v1.jpg"],
  ] as const)("uses the %s image for Open Graph and Twitter", (locale, path, image) => {
    const metadata = createPageMetadata({ title: "Easy Cut", description: "Create Shorts", path: "/", locale });
    expect(metadata.alternates?.canonical).toBe(`https://www.easycut.co.kr${path}`);
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: image, width: 1200, height: 630 })]);
    expect(metadata.twitter?.images).toEqual([image]);
  });
});
