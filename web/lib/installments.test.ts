import { describe, expect, it } from "vitest";
import {
  getActiveInstallmentOffer,
  installmentResponseMatchesSelection,
  MANUAL_INSTALLMENT_MAX_MONTHS,
  normalizeInstallmentIssuer,
  validateInstallmentSelection,
} from "./installments";

function fakeDb(resultSets: Array<Array<Record<string, unknown>>>) {
  let index = 0;
  return (() => Promise.resolve(resultSets[index++] || [])) as never;
}

const campaign = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "2026년 7월",
  effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
  effectiveTo: new Date("2026-07-31T00:00:00.000Z"),
  defaultMinAmountKrw: 50_000,
  notice: "안내",
};

function capabilities(...months: number[]) {
  return months.map((installmentMonths) => ({ installmentMonths }));
}

function kbThreeMonthTerm() {
  return {
    id: "term-3",
    issuerCode: "kb",
    issuerName: "국민카드",
    benefitType: "interest_free",
    installmentMonths: 3,
    customerPaidInstallments: null,
    minAmountKrw: 50_000,
    displayOrder: 1,
    note: "무이자",
  };
}

describe("installment campaigns", () => {
  it("does not reuse an expired campaign when there is no active publication", async () => {
    await expect(getActiveInstallmentOffer(fakeDb([[], []]), {
      amountKrw: 191_040,
    })).resolves.toMatchObject({
      campaignId: null,
      terms: [],
      selectableMonths: [],
      selectableOptions: [],
    });
  });

  it("separates general 2-12 month capability from exact campaign benefits", async () => {
    const offer = await getActiveInstallmentOffer(fakeDb([
      [campaign],
      capabilities(2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12),
      [
        {
          id: "term-3", issuerCode: "kb", issuerName: "국민카드",
          benefitType: "interest_free", installmentMonths: 3,
          customerPaidInstallments: null, minAmountKrw: 50_000, displayOrder: 1,
          note: "",
        },
        {
          id: "term-10", issuerCode: "kb", issuerName: "국민카드",
          benefitType: "partial_interest_free", installmentMonths: 10,
          customerPaidInstallments: 5, minAmountKrw: 50_000, displayOrder: 1,
          note: "",
        },
        {
          id: "term-18", issuerCode: "kb", issuerName: "국민카드",
          benefitType: "partial_interest_free", installmentMonths: 18,
          customerPaidInstallments: 7, minAmountKrw: 50_000, displayOrder: 2,
          note: "",
        },
      ],
    ]), {
      amountKrw: 191_040,
      issuer: "KB국민카드",
      credentialScope: "manual",
    });
    expect(offer.terms).toHaveLength(3);
    expect(offer.selectableMonths).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(offer.selectableOptions.find((option) => option.installmentMonths === 3))
      .toMatchObject({ benefitType: "interest_free", campaignTermId: "term-3" });
    expect(offer.selectableOptions.find((option) => option.installmentMonths === 6))
      .toMatchObject({ benefitType: "standard_interest", campaignTermId: null });
    expect(offer.selectableOptions.find((option) => option.installmentMonths === 10))
      .toMatchObject({
        benefitType: "partial_interest_free",
        customerPaidInstallments: 5,
      });
    expect(offer.terms.find((term) => term.installmentMonths === 18)).toMatchObject({
      providerSupported: false,
      selectable: false,
    });
    expect(MANUAL_INSTALLMENT_MAX_MONTHS).toBe(12);
  });

  it("uses campaign terms up to 12 months during an explicitly gated local checkout", async () => {
    const unverifiedTwelveMonthTerm = {
      ...kbThreeMonthTerm(),
      id: "term-local-12",
      benefitType: "partial_interest_free",
      installmentMonths: 12,
      customerPaidInstallments: 5,
    };
    const offer = await getActiveInstallmentOffer(fakeDb([
      [campaign],
      [],
      [
        unverifiedTwelveMonthTerm,
        {
          ...unverifiedTwelveMonthTerm,
          id: "term-local-18",
          installmentMonths: 18,
        },
      ],
    ]), {
      amountKrw: 288_000,
      credentialScope: "manual",
      localManualCheckout: true,
    });
    expect(offer.selectableMonths).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(offer.terms.find((term) => term.installmentMonths === 18))
      .toMatchObject({ providerSupported: false, selectable: false });

    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      [],
      [unverifiedTwelveMonthTerm],
    ]), {
      billingCycle: "yearly",
      amountKrw: 288_000,
      installmentMonths: 12,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "package",
      credentialScope: "manual",
      localManualCheckout: true,
    })).resolves.toMatchObject({
      snapshot: {
        issuerCode: "kb",
        installmentMonths: 12,
      },
    });
  });

  it("keeps subscriptions and non-manual add-ons cash-only", async () => {
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "yearly",
      amountKrw: 70_965,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "현대카드",
      productKind: "subscription",
      credentialScope: "default",
    })).rejects.toMatchObject({ code: "INSTALLMENT_NOT_ALLOWED" });
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "yearly",
      amountKrw: 50_000,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "addon",
      credentialScope: "default",
    })).rejects.toMatchObject({ code: "INSTALLMENT_NOT_ALLOWED" });
  });

  it("blocks package installments below 50,000 won", async () => {
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "yearly",
      amountKrw: 49_999,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "package",
      credentialScope: "manual",
    })).rejects.toMatchObject({ code: "INSTALLMENT_MIN_AMOUNT_NOT_MET" });
  });

  it("allows a verified manual-terminal 3-month campaign term", async () => {
    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      capabilities(3),
      [kbThreeMonthTerm()],
    ]), {
      billingCycle: "yearly",
      amountKrw: 70_965,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "KB국민카드",
      productKind: "package",
      credentialScope: "manual",
    })).resolves.toMatchObject({
      campaignId: campaign.id,
      snapshot: {
        credentialScope: "manual",
        productKind: "package",
        issuerCode: "kb",
        issuerName: "국민카드",
        benefitType: "interest_free",
        installmentMonths: 3,
        minAmountKrw: 50_000,
      },
    });
  });

  it("allows an exact mapped 12-month term but rejects longer manual installments", async () => {
    const twelveMonthTerm = {
      ...kbThreeMonthTerm(),
      id: "term-12",
      benefitType: "partial_interest_free",
      installmentMonths: 12,
      customerPaidInstallments: 5,
    };
    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      capabilities(12),
      [twelveMonthTerm],
    ]), {
      billingCycle: "yearly",
      amountKrw: 191_040,
      installmentMonths: 12,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "package",
      credentialScope: "manual",
    })).resolves.toMatchObject({
      snapshot: {
        issuerCode: "kb",
        installmentMonths: 12,
        customerPaidInstallments: 5,
      },
    });
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "yearly",
      amountKrw: 191_040,
      installmentMonths: 13,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "package",
      credentialScope: "manual",
    })).rejects.toMatchObject({ code: "INSTALLMENT_MONTHS_EXCEEDED" });
  });

  it("requires an explicit card issuer before allowing package installments", async () => {
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "yearly",
      amountKrw: 70_965,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: null,
      productKind: "package",
      credentialScope: "manual",
    })).rejects.toMatchObject({ code: "INSTALLMENT_ISSUER_REQUIRED" });
  });

  it("blocks changed campaigns, unknown issuers, and disabled terminal months", async () => {
    const input = {
      billingCycle: "yearly" as const,
      amountKrw: 70_965,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "KB국민카드",
      productKind: "package" as const,
      credentialScope: "manual" as const,
    };
    await expect(validateInstallmentSelection(fakeDb([[], capabilities(3)]), input))
      .rejects.toMatchObject({ code: "INSTALLMENT_CAMPAIGN_CHANGED" });
    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      capabilities(3),
      [kbThreeMonthTerm()],
    ]), {
      ...input,
      campaignId: "22222222-2222-4222-8222-222222222222",
    })).rejects.toMatchObject({ code: "INSTALLMENT_CAMPAIGN_CHANGED" });
    await expect(validateInstallmentSelection(fakeDb([]), {
      ...input,
      issuer: "알 수 없는 카드",
    })).rejects.toMatchObject({ code: "INSTALLMENT_ISSUER_REQUIRED" });
    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      [],
      [kbThreeMonthTerm()],
    ]), input)).rejects.toMatchObject({ code: "INSTALLMENT_NOT_SUPPORTED" });
  });

  it("allows Hyundai 6-month general interest and keeps its 12-month campaign benefit", async () => {
    const hyundaiTwelveMonthTerm = {
      id: "hyundai-12",
      issuerCode: "hyundai",
      issuerName: "현대카드",
      benefitType: "partial_interest_free",
      installmentMonths: 12,
      customerPaidInstallments: 6,
      minAmountKrw: 50_000,
      displayOrder: 50,
      note: "",
    };
    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      capabilities(6, 12),
      [hyundaiTwelveMonthTerm],
    ]), {
      billingCycle: "yearly",
      amountKrw: 288_000,
      installmentMonths: 6,
      campaignId: campaign.id,
      issuer: "현대카드",
      productKind: "package",
      credentialScope: "manual",
    })).resolves.toMatchObject({
      campaignId: campaign.id,
      snapshot: {
        issuerCode: "hyundai",
        installmentMonths: 6,
        benefitType: "standard_interest",
        campaignTermId: null,
      },
    });
    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      capabilities(6, 12),
      [hyundaiTwelveMonthTerm],
    ]), {
      billingCycle: "yearly",
      amountKrw: 288_000,
      installmentMonths: 12,
      campaignId: campaign.id,
      issuer: "현대카드",
      productKind: "package",
      credentialScope: "manual",
    })).resolves.toMatchObject({
      snapshot: {
        installmentMonths: 12,
        benefitType: "partial_interest_free",
        customerPaidInstallments: 6,
        campaignTermId: "hyundai-12",
      },
    });
  });

  it("allows general installments even when there is no active campaign", async () => {
    await expect(validateInstallmentSelection(fakeDb([
      [],
      capabilities(6),
    ]), {
      billingCycle: "yearly",
      amountKrw: 288_000,
      installmentMonths: 6,
      campaignId: null,
      issuer: "현대카드",
      productKind: "package",
      credentialScope: "manual",
    })).resolves.toMatchObject({
      campaignId: null,
      snapshot: {
        issuerCode: "hyundai",
        installmentMonths: 6,
        benefitType: "standard_interest",
      },
    });
  });

  it("does not apply default-terminal capability to package installments", async () => {
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "yearly",
      amountKrw: 70_965,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "package",
      credentialScope: "default",
    })).rejects.toMatchObject({ code: "INSTALLMENT_NOT_ALLOWED" });
  });

  it("allows 84,000/120,000-won add-ons but blocks 48,000-won add-on installments", async () => {
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "yearly",
      amountKrw: 48_000,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "addon",
      credentialScope: "manual",
    })).rejects.toMatchObject({ code: "INSTALLMENT_MIN_AMOUNT_NOT_MET" });
    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      capabilities(3),
      [kbThreeMonthTerm()],
    ]), {
      billingCycle: "yearly",
      amountKrw: 84_000,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "addon",
      credentialScope: "manual",
    })).resolves.toMatchObject({
      campaignId: campaign.id,
      snapshot: {
        credentialScope: "manual",
        productKind: "addon",
        installmentMonths: 3,
      },
    });
    await expect(validateInstallmentSelection(fakeDb([
      [campaign],
      capabilities(3),
      [kbThreeMonthTerm()],
    ]), {
      billingCycle: "yearly",
      amountKrw: 120_000,
      installmentMonths: 3,
      campaignId: campaign.id,
      issuer: "국민카드",
      productKind: "addon",
      credentialScope: "manual",
    })).resolves.toMatchObject({
      campaignId: campaign.id,
      snapshot: {
        credentialScope: "manual",
        productKind: "addon",
        installmentMonths: 3,
      },
    });
  });

  it("always accepts cash without a campaign for every product", async () => {
    await expect(validateInstallmentSelection(fakeDb([]), {
      billingCycle: "monthly",
      amountKrw: 9_900,
      installmentMonths: 0,
      productKind: "subscription",
      credentialScope: "default",
    })).resolves.toEqual({ campaignId: null, snapshot: {} });
  });

  it("normalizes the supported Korean issuer names", () => {
    expect(normalizeInstallmentIssuer("KB 국민카드")).toBe("kb");
    expect(normalizeInstallmentIssuer("NH농협")).toBe("nh");
    expect(normalizeInstallmentIssuer("알 수 없는 카드")).toBeNull();
  });

  it("matches both installment months and issuer for a manual approval", () => {
    expect(installmentResponseMatchesSelection({
      requestedMonths: 3,
      responseMonths: 3,
      requestedIssuer: "kb",
      responseIssuer: "KB국민카드",
    })).toBe(true);
    expect(installmentResponseMatchesSelection({
      requestedMonths: 3,
      responseMonths: 0,
      requestedIssuer: "kb",
      responseIssuer: "KB국민카드",
    })).toBe(false);
    expect(installmentResponseMatchesSelection({
      requestedMonths: 3,
      responseMonths: 3,
      requestedIssuer: "kb",
      responseIssuer: "신한카드",
    })).toBe(false);
    expect(installmentResponseMatchesSelection({
      requestedMonths: 3,
      responseMonths: 3,
      requestedIssuer: "hyundai",
      responseIssuer: "NOL 카드",
      responseAcquirer: "현대카드",
    })).toBe(true);
    expect(installmentResponseMatchesSelection({
      requestedMonths: 3,
      responseMonths: 3,
      requestedIssuer: "hyundai",
      responseIssuer: "NOL 카드",
      responseAcquirer: "롯데카드",
    })).toBe(false);
  });
});
