import { describe, expect, it } from "vitest";

import nextConfig from "./next.config.mjs";

describe("admin prefetch routing", () => {
  it("routes Next.js admin prefetches to the no-op endpoint", async () => {
    const rewrites = await nextConfig.rewrites();

    expect(rewrites.beforeFiles).toContainEqual({
      source: "/admin/easycutcutcutcutcutcut",
      has: [
        { type: "header", key: "next-router-prefetch", value: "1|2" },
      ],
      destination: "/api/admin/prefetch-noop",
    });
  });
});
