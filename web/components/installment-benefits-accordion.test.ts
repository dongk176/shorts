import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const accordionSource = readFileSync(
  new URL("./installment-benefits-accordion.tsx", import.meta.url),
  "utf8",
);
const detailSource = readFileSync(
  new URL("./installment-benefit-details.tsx", import.meta.url),
  "utf8",
);

describe("installment benefits accordion", () => {
  it("exposes keyboard and expanded-state semantics", () => {
    expect(accordionSource).toContain("aria-expanded={open}");
    expect(accordionSource).toContain("aria-controls={panelId}");
    expect(accordionSource).toContain("focus-visible:ring");
    expect(accordionSource).toContain("min-h-[72px]");
    expect(accordionSource).toContain("현재 결제에서 선택 가능");
    expect(accordionSource).toContain("카드사별 이번 달 전체 혜택");
    expect(accordionSource).toContain("전체 카드사 혜택 조건");
    expect(accordionSource).toContain("aria-expanded={showAllTerms}");
    expect(accordionSource).toContain("최대 ${maxSelectableMonths}개월 선택 가능");
  });

  it("groups exact selectable terms by issuer and labels unsupported campaign months", () => {
    expect(accordionSource).toContain("term.selectable");
    expect(accordionSource).toContain("selectableIssuerGroups");
    expect(accordionSource).toContain(
      "onSelect(term.issuerCode, term.installmentMonths)",
    );
    expect(detailSource).toContain("현재 결제창 미지원");
  });
});
