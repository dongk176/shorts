import { describe, expect, it } from "vitest";
import type { InstallmentTerm } from "./installments";
import {
  compactInstallmentMonths,
  groupInstallmentTerms,
} from "./installment-display";

function term(overrides: Partial<InstallmentTerm>): InstallmentTerm {
  return {
    id: "term",
    issuerCode: "bc",
    issuerName: "BC카드",
    benefitType: "interest_free",
    installmentMonths: 2,
    customerPaidInstallments: null,
    minAmountKrw: 50_000,
    displayOrder: 10,
    note: "",
    providerSupported: true,
    selectable: true,
    ...overrides,
  };
}

describe("installment benefit display", () => {
  it("compacts consecutive months into readable ranges", () => {
    expect(compactInstallmentMonths([5, 2, 4, 3, 10, 12]))
      .toBe("2~5개월, 10개월, 12개월");
  });

  it("groups issuer terms while separating provider-pending months", () => {
    const groups = groupInstallmentTerms([
      term({ id: "2", installmentMonths: 2 }),
      term({ id: "3", installmentMonths: 3 }),
      term({
        id: "18",
        benefitType: "partial_interest_free",
        installmentMonths: 18,
        customerPaidInstallments: 7,
        providerSupported: false,
        selectable: false,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toEqual([
      expect.objectContaining({
        benefitType: "interest_free",
        supportedMonths: [2, 3],
        pendingMonths: [],
      }),
      expect.objectContaining({
        benefitType: "partial_interest_free",
        customerPaidInstallments: 7,
        supportedMonths: [],
        pendingMonths: [18],
      }),
    ]);
  });
});
