import { describe, expect, it } from "vitest";
import {
  getActiveInstallmentOffer,
  normalizeInstallmentIssuer,
  validateInstallmentSelection,
} from "./installments";

function fakeDb(resultSets: Array<Array<Record<string, unknown>>>) {
  let index = 0;
  return (() => Promise.resolve(resultSets[index++] || [])) as never;
}

describe("installment campaigns", () => {
  it("does not reuse an expired campaign when there is no active publication", async () => {
    await expect(getActiveInstallmentOffer(fakeDb([[]]), {
      amountKrw: 191_040,
    })).resolves.toMatchObject({
      campaignId: null,
      terms: [],
      selectableMonths: [],
    });
  });

  it("shows unsupported benefit terms but excludes them from selectable months", async () => {
    const campaign = {
      id: "campaign-1",
      name: "2026년 7월",
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-07-31T00:00:00.000Z"),
      defaultMinAmountKrw: 50_000,
      notice: "안내",
    };
    const offer = await getActiveInstallmentOffer(fakeDb([[campaign], [
      {
        id: "term-10", issuerCode: "kb", issuerName: "국민카드",
        benefitType: "partial_interest_free", installmentMonths: 10,
        customerPaidInstallments: 5, minAmountKrw: 50_000, displayOrder: 1,
        note: "", providerSupported: true,
      },
      {
        id: "term-18", issuerCode: "kb", issuerName: "국민카드",
        benefitType: "partial_interest_free", installmentMonths: 18,
        customerPaidInstallments: 7, minAmountKrw: 50_000, displayOrder: 2,
        note: "", providerSupported: false,
      },
    ]]), { amountKrw: 191_040, issuer: "KB국민카드" });
    expect(offer.terms).toHaveLength(2);
    expect(offer.selectableMonths).toEqual([10]);
    expect(offer.terms.find((term) => term.installmentMonths === 18)).toMatchObject({
      providerSupported: false,
      selectable: false,
    });
  });

  it("blocks installments on annual charges", async () => {
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "yearly",
      amountKrw: 9_999,
      installmentMonths: 3,
      campaignId: "campaign-1",
      issuer: "현대카드",
    })).rejects.toMatchObject({ code: "INSTALLMENT_NOT_ALLOWED" });
  });

  it("blocks installments on monthly charges even when the client sends a campaign", async () => {
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "monthly",
      amountKrw: 49_900,
      installmentMonths: 3,
      campaignId: "campaign-1",
    })).rejects.toMatchObject({ code: "INSTALLMENT_NOT_ALLOWED" });
  });

  it("normalizes the supported Korean issuer names", () => {
    expect(normalizeInstallmentIssuer("KB 국민카드")).toBe("kb");
    expect(normalizeInstallmentIssuer("NH농협")).toBe("nh");
    expect(normalizeInstallmentIssuer("알 수 없는 카드")).toBeNull();
  });
});
