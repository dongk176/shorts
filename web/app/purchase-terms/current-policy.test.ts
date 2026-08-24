import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const currentPage = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const document = readFileSync(
  new URL("./versions/2/purchase-terms-v2-document.tsx", import.meta.url),
  "utf8",
);
const archivedV7 = readFileSync(
  new URL("./versions/7/page.tsx", import.meta.url),
  "utf8",
);

describe("current paid-service purchase terms", () => {
  it("publishes v8 while preserving v7 for existing payment contracts", () => {
    expect(currentPage).toContain("version={8}");
    expect(document).toContain("2026년 8월 24일 개정 · 구매약관 v8");
    expect(archivedV7).toContain("archived version={7}");
  });

  it("describes immediate Pro-to-package replacement and fail-closed compensation", () => {
    expect(document).toContain("현재 Pro 원결제 9,900원의 전액취소가 확인되어야");
    expect(document).toContain("패키지로 즉시 전환됩니다");
    expect(document).toContain("패키지 승인을 전액취소하고 기존 Pro 이용권을 유지합니다");
    expect(document).toContain("패키지를 자동 활성화하지 않고");
  });

  it("adds Toss-only automatic billing terms without removing ThePayOne terms", () => {
    expect(document).toContain("기존 더페이원 결제자");
    expect(document).toContain("토스 자동결제로 안내된 이용자와 주문에만 적용");
    expect(document).toContain("월 환산 금액은 비교를 위한 표시일 뿐");
    expect(document).toContain("남은 시간 비율에 따른 미사용 금액을 공제한 차액");
    expect(document).toContain("계약 총액이 같거나 낮은 플랜은 현재 계약 종료일로 변경을 예약");
    expect(document).toContain("빌링키를 다시 암호화해 저장");
    expect(document).toContain("제3조부터 제6조까지의 월간 구독·기간 패키지 조건을 계속 적용");
  });
});
