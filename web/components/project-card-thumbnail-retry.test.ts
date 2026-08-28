import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./project-card.tsx", import.meta.url), "utf8");

describe("project source thumbnail recovery", () => {
  it("remounts the protected thumbnail when the upload job advances", () => {
    expect(source).toContain('key={`${job.thumbnailUrl}:${job.stage}:${job.status}`}');
  });
});
