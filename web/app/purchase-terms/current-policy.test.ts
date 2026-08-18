import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const currentPage = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const document = readFileSync(
  new URL("./versions/2/purchase-terms-v2-document.tsx", import.meta.url),
  "utf8",
);

describe("current paid-service purchase terms", () => {
  it("publishes v7 while preserving the archived v6 route", () => {
    expect(currentPage).toContain("version={7}");
    expect(document).toContain("2026년 8월 18일 개정 · 구매약관 v7");
  });

  it("describes immediate Pro-to-package replacement and fail-closed compensation", () => {
    expect(document).toContain("현재 Pro 원결제 9,900원의 전액취소가 확인되어야");
    expect(document).toContain("패키지로 즉시 전환됩니다");
    expect(document).toContain("패키지 승인을 전액취소하고 기존 Pro 이용권을 유지합니다");
    expect(document).toContain("패키지를 자동 활성화하지 않고");
  });
});
