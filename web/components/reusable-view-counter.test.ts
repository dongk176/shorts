import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./reusable-view-counter.tsx", import.meta.url),
  "utf8",
);

describe("reusable view counter UI", () => {
  it("links the complete counter to the public popular page", () => {
    expect(source).toContain('href="/popular"');
    expect(source).toContain('return "누적 조회수"');
    expect(source).toContain('return `${formatted}회`');
  });

  it("updates locally without polling the server", () => {
    expect(source).toContain("window.setTimeout(");
    expect(source).toContain("COUNTER_ANIMATION_DURATION_MS = 1_800");
    expect(source).toContain("window.requestAnimationFrame(animate)");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("requestJson");
  });
});
