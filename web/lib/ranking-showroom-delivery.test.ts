import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { rankingShowroomVideo } from "./ranking-showroom-delivery";
import { rankingShowroomContent } from "./ranking-showroom-content";
import manifest from "./ranking-showroom-delivery.json";

describe("ranking public showcase delivery", () => {
  it("serves every displayed example and introduction from the existing CDN with byte-identical originals", () => {
    for (const locale of ["ko", "en", "ja"] as const) {
      for (const name of new Set([...rankingShowroomContent[locale].samples.map(sample => sample.name), "dogs"])) {
        const asset = manifest.assets[`${locale}/${name}` as keyof typeof manifest.assets];
        const original = readFileSync(new URL(`../public/${asset.source}`, import.meta.url));
        expect(createHash("sha256").update(original).digest("hex")).toBe(asset.sha256);
        expect(original.length).toBe(asset.bytes);
        expect(rankingShowroomVideo(locale, name)).toBe(`${manifest.origin}/${asset.path}`);
        expect(asset.path).toContain(asset.sha256.slice(0,16));
      }
    }
  });
  it("does not silently send missing examples back to Vercel", () => {
    expect(() => rankingShowroomVideo("ko", "missing")).toThrow("Missing ranking showcase");
  });
});
