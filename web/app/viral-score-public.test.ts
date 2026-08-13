import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("public viral score badge", () => {
  it("shows scores only when a generated short has one", () => {
    const source = readFileSync(join(process.cwd(), "app", "shorts-app.tsx"), "utf8");

    expect(source).toContain("item.viralScore != null");
    expect(source).toContain("AI 바이럴 점수 {item.viralScore}/100");
    expect(source).toContain("대본을 바탕으로 AI가 예측한 점수입니다");
  });
});
