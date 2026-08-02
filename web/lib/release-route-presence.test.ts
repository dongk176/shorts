import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("protected public release routes", () => {
  it("keeps the guidebook route and all eight pages in release builds", () => {
    const root = process.cwd();

    expect(existsSync(path.join(root, "app/guidebook/page.tsx"))).toBe(true);
    for (let page = 1; page <= 8; page += 1) {
      expect(existsSync(path.join(
        root,
        `public/guidebook/pages/page-${page}.jpg`,
      ))).toBe(true);
    }
  });
});
