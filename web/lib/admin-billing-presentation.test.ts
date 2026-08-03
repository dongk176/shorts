import { describe, expect, it } from "vitest";
import {
  adminPaymentDetailParts,
  adminPaymentFailureLabel,
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

  it.each([
    ["2075", "승인실패 / 체크카드 계좌잔액 부족", "잔액 부족"],
    ["2063", "승인실패 / 개인월간한도초과", "한도 초과"],
    ["2041", "승인실패 / 비밀번호 오류", "비밀번호 오류"],
    ["2044", "승인실패 / 주민번호 / 사업자번호 오류", "본인확인 정보 오류"],
    ["9999", "유효기간이 잘못되었습니다.", "카드 유효기간 오류"],
    ["9999", "대상 조회 불가능", "결제 대상 조회 실패"],
    ["9999", null, "결제사 확인 필요"],
  ])("shows a readable payment failure reason for %s", (failureCode, failureMessage, label) => {
    expect(adminPaymentFailureLabel({ failureCode, failureMessage })).toBe(label);
  });
});
