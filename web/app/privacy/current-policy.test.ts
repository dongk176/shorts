import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const policy = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

describe("current privacy policy payment processors", () => {
  it("keeps ThePayOne and adds the Toss billing data flow", () => {
    expect(policy).toContain("2026년 8월 24일");
    expect(policy).toContain("더페이원 카드 ID 또는 토스 빌링키");
    expect(policy).toContain("<tr><td>더페이원</td>");
    expect(policy).toContain("<tr><td>토스페이먼츠 주식회사</td>");
    expect(policy).toContain("토스 고객 식별자·인증키·빌링키");
    expect(policy).toContain("카드 비밀번호·CVC");
  });
});
