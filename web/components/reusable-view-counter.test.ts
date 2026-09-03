import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./reusable-view-counter.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/site-sidebar.css", import.meta.url),
  "utf8",
);

describe("reusable view counter UI", () => {
  it("toggles between cumulative views and the generated shorts total", () => {
    expect(source).toContain("const [showingViews, setShowingViews] = useState(true)");
    expect(source).toContain("setShowingViews((current) => !current)");
    expect(source).toContain('data-metric="views"');
    expect(source).toContain('data-metric="generated-shorts"');
    expect(source).toContain('return "누적 조회수"');
    expect(source).toContain('return "지금까지 생성된 쇼츠"');
    expect(source).toContain('return `${formatted}회`');
    expect(source).not.toContain('href="/popular"');
  });

  it("updates locally without polling the server", () => {
    expect(source).toContain("window.setTimeout(");
    expect(source).toContain("COUNTER_ANIMATION_DURATION_MS = 1_800");
    expect(source).toContain("window.requestAnimationFrame(animate)");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("requestJson");
  });

  it("uses a visual panel transition instead of a typewriter effect", () => {
    expect(source).toContain('className="home-metric-stage"');
    expect(source).toContain('className={`home-metric-panel ${showingViews ? "is-active" : ""}`}');
    expect(source).not.toContain("typewriter");
    expect(styles).toContain("opacity 320ms ease");
    expect(styles).toContain("transform 380ms cubic-bezier(.22,1,.36,1)");
    expect(styles).toContain("filter 320ms ease");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
