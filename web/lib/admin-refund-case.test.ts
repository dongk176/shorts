import { describe, expect, it } from "vitest";
import { buildRefundGuide } from "./admin-refund-case";
import { quoteFirstCompletedJobRefund } from "./refund-policy";

describe("first completed job refund policy", () => {
  it("refunds the full payment before the first job completes", () => {
    expect(quoteFirstCompletedJobRefund({
      actualPaymentKrw: 119_400,
      prepaidMonths: 6,
      firstJobCompleted: false,
    })).toMatchObject({
      monthlyDeductionKrw: 0,
      policyRefundTotalKrw: 119_400,
      refundAmountKrw: 119_400,
    });
  });

  it("deducts exactly one paid month after the first job completes", () => {
    expect(quoteFirstCompletedJobRefund({
      actualPaymentKrw: 119_400,
      prepaidMonths: 6,
      firstJobCompleted: true,
    })).toMatchObject({
      monthlyDeductionKrw: 19_900,
      policyRefundTotalKrw: 99_500,
      refundAmountKrw: 99_500,
    });
  });

  it("deducts prior refunds from the policy total", () => {
    expect(quoteFirstCompletedJobRefund({
      actualPaymentKrw: 198_000,
      refundedOrReservedKrw: 20_000,
      prepaidMonths: 12,
      firstJobCompleted: true,
    }).refundAmountKrw).toBe(161_500);
  });

  it("leaves no refundable amount for a used one-month subscription", () => {
    expect(quoteFirstCompletedJobRefund({
      actualPaymentKrw: 9_900,
      prepaidMonths: 1,
      firstJobCompleted: true,
    }).refundAmountKrw).toBe(0);
  });
});

describe("refund guidance copy", () => {
  it("includes payment, usage, refund, and access details", () => {
    const copy = buildRefundGuide({
      customerName: "김이지",
      email: "easy@example.com",
      orderId: "ORDER-20260728",
      productName: "스타터 패키지 6개월",
      approvedAt: "2026-07-28T01:00:00.000Z",
      amountKrw: 119_400,
      firstJobCompleted: true,
      firstCompletedJobAt: "2026-07-28T03:00:00.000Z",
      monthlyDeductionKrw: 19_900,
      plannedRefundKrw: 99_500,
      status: "in_progress",
      paymentStatus: "not_started",
      providerReference: null,
      billingAction: "none",
      entitlementAction: "end_at_current_period",
      entitlementEffectiveAt: "2026-08-28T01:00:00.000Z",
    });

    expect(copy).toContain("주문번호: ORDER-20260728");
    expect(copy).toContain("1개월분 19,900원");
    expect(copy).toContain("환불 예정액: 99,500원");
    expect(copy).toContain("업무 진행 중");
    expect(copy).toContain("실제 결제 환불 미처리");
    expect(copy).toContain("2026년 8월 28일");
  });

  it("only calls the amount processed after payment refund completion is recorded", () => {
    const copy = buildRefundGuide({
      customerName: null,
      email: "easy@example.com",
      orderId: "ORDER-COMPLETE",
      productName: "월간 구독",
      approvedAt: "2026-07-28T01:00:00.000Z",
      amountKrw: 9_900,
      firstJobCompleted: false,
      firstCompletedJobAt: null,
      monthlyDeductionKrw: 0,
      plannedRefundKrw: 9_900,
      status: "completed",
      paymentStatus: "completed",
      providerReference: "REFUND-1",
      billingAction: "pause_now_keep_until_period_end",
      entitlementAction: "end_at_current_period",
      entitlementEffectiveAt: "2026-08-28T01:00:00.000Z",
    });

    expect(copy).toContain("처리 환불액: 9,900원");
    expect(copy).toContain("실제 결제 환불 완료");
    expect(copy).toContain("환불 확인번호: REFUND-1");
  });
});
