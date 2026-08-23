import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectRevealSource = readFileSync(
  new URL("../components/project-reveal.tsx", import.meta.url),
  "utf8",
);

describe("project reveal source copy", () => {
  it("uses source-neutral copy for both YouTube and uploaded videos", () => {
    expect(projectRevealSource).toContain("ORIGINAL VIDEO");
    expect(projectRevealSource).not.toContain("YOUTUBE ORIGINAL");
    expect(projectRevealSource).toContain("원본 영상 썸네일");
    expect(projectRevealSource).toContain("Source video thumbnail");
    expect(projectRevealSource).toContain("元動画サムネイル");
  });
});
