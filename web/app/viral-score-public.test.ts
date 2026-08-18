import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("public viral score badge", () => {
  it("shows scores only when a generated short has one", () => {
    const source = readFileSync(join(process.cwd(), "app", "shorts-app.tsx"), "utf8");

    expect(source).toContain("item.viralScore != null");
    expect(source).toContain("`바이럴 점수 ${item.viralScore}/100`");
    expect(source).toContain("`Viral score ${item.viralScore}/100`");
    expect(source).toContain("`バイラルスコア ${item.viralScore}/100`");
    expect(source).not.toContain("AI 바이럴 점수");
    expect(source).toContain('className="viral-score-badge"');
    expect(source).toContain("대본을 바탕으로 AI가 예측한 점수입니다");
  });

  it("places the compact score badge below the title on mobile", () => {
    const styles = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

    expect(styles).toContain("border-radius: 5px");
    expect(styles).toContain("grid-template-columns: max-content minmax(0,1fr)");
    expect(styles).toContain(".short-result-heading .viral-score-badge { grid-column: 2");
  });
});
