import { describe, expect, it } from "vitest";
import {
  adminPaymentDetailParts,
  adminPaymentFlowLabel,
} from "./admin-billing-presentation";

describe("admin billing presentation", () => {
  it("describes an arti02 manual installment payment", () => {
    const order = {
      provider: "thepayone",
      providerTerminalId: "arti02",
      hasPaymentMethod: false,
      credentialScope: "manual",
      installmentMonths: 3,
      cardIssuerName: "국민카드",
      installmentBenefitType: "interest_free",
      declaredCardKind: "credit",
    };

    expect(adminPaymentFlowLabel(order)).toBe("수기결제");
    expect(adminPaymentDetailParts(order)).toEqual([
      "국민카드",
      "신용카드",
      "3개월 할부",
      "무이자",
    ]);
  });

  it("keeps legacy stored-card payments distinguishable", () => {
    const order = {
      provider: "thepayone",
      providerTerminalId: "arti01",
      hasPaymentMethod: true,
      credentialScope: null,
      installmentMonths: 0,
      cardIssuerName: "신한카드",
      installmentBenefitType: null,
      declaredCardKind: null,
    };

    expect(adminPaymentFlowLabel(order)).toBe("저장카드");
    expect(adminPaymentDetailParts(order)).toEqual(["신한카드", "일시불"]);
  });

  it("does not mislabel a failed arti01 subscription as manual", () => {
    const order = {
      provider: "thepayone",
      providerTerminalId: "arti01",
      hasPaymentMethod: false,
      credentialScope: null,
      installmentMonths: 0,
      cardIssuerName: null,
      installmentBenefitType: null,
      declaredCardKind: null,
    };

    expect(adminPaymentFlowLabel(order)).toBe("정기결제");
    expect(adminPaymentDetailParts(order)).toEqual(["일시불"]);
  });

  it("treats one-time ThePayOne orders without a stored method as manual", () => {
    const order = {
      provider: "thepayone",
      providerTerminalId: "arti02",
      hasPaymentMethod: false,
      credentialScope: null,
      installmentMonths: 0,
      cardIssuerName: null,
      installmentBenefitType: null,
      declaredCardKind: "cash",
    };

    expect(adminPaymentFlowLabel(order)).toBe("수기결제");
    expect(adminPaymentDetailParts(order)).toEqual(["체크·선불카드", "일시불"]);
  });

  it("does not infer manual payment only from a missing stored method", () => {
    const order = {
      provider: "thepayone",
      providerTerminalId: null,
      hasPaymentMethod: false,
      credentialScope: null,
      installmentMonths: 0,
      cardIssuerName: null,
      installmentBenefitType: null,
      declaredCardKind: null,
    };

    expect(adminPaymentFlowLabel(order)).toBeNull();
  });
});
