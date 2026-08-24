import { describe, expect, it } from "vitest";
import {
  addReferralKstMonths,
  calculateReferralCommission,
  calculateReferralCommissionInstallments,
  isReferralLoginId,
  isReferralSlug,
  maskedReferralEmail,
  normalizeReferralCampaign,
} from "@/lib/referral-policy";

describe("referral policy", () => {
  it("validates slugs and blocks application routes", () => {
    expect(isReferralSlug("creator-one")).toBe(true);
    expect(isReferralSlug("Creator-One")).toBe(true);
    expect(isReferralSlug("admin")).toBe(false);
    expect(isReferralSlug("123")).toBe(false);
    expect(isReferralSlug("bad--slug")).toBe(false);
  });

  it("validates partner login ids", () => {
    expect(isReferralLoginId("creator.01")).toBe(true);
    expect(isReferralLoginId("1creator")).toBe(false);
    expect(isReferralLoginId("ab")).toBe(false);
  });

  it("calculates commission from the post-refund amount and floors won", () => {
    expect(calculateReferralCommission(9_900, 0, 2_000)).toBe(1_980);
    expect(calculateReferralCommission(9_999, 1_111, 1_333)).toBe(1_184);
    expect(calculateReferralCommission(1_000, 2_000, 2_000)).toBe(0);
  });

  it("recognizes a six-month prepaid commission one month at a time", () => {
    const installments = calculateReferralCommissionInstallments({
      amountKrw: 119_400,
      refundedAmountKrw: 0,
      commissionRateBps: 2_000,
      recognitionMonths: 6,
      approvedAt: new Date("2026-08-18T03:00:00.000Z"),
    });

    expect(installments).toHaveLength(6);
    expect(installments.map((item) => item.grossAmountKrw))
      .toEqual([19_900, 19_900, 19_900, 19_900, 19_900, 19_900]);
    expect(installments.map((item) => item.commissionAmountKrw))
      .toEqual([3_980, 3_980, 3_980, 3_980, 3_980, 3_980]);
    expect(installments.reduce((sum, item) => sum + item.commissionAmountKrw, 0))
      .toBe(23_880);
    expect(installments[0].availableAt.toISOString()).toBe("2026-08-25T03:00:00.000Z");
    expect(installments[1].availableAt.toISOString()).toBe("2026-09-25T03:00:00.000Z");
  });

  it("keeps won rounding exact when the payment does not divide evenly", () => {
    const installments = calculateReferralCommissionInstallments({
      amountKrw: 119_000,
      refundedAmountKrw: 0,
      commissionRateBps: 2_000,
      recognitionMonths: 6,
      approvedAt: new Date("2026-08-18T03:00:00.000Z"),
    });

    expect(installments.reduce((sum, item) => sum + item.grossAmountKrw, 0)).toBe(119_000);
    expect(installments.reduce((sum, item) => sum + item.commissionAmountKrw, 0))
      .toBe(23_800);
  });

  it("removes refunded revenue from future installments first", () => {
    const installments = calculateReferralCommissionInstallments({
      amountKrw: 119_400,
      refundedAmountKrw: 99_500,
      commissionRateBps: 2_000,
      recognitionMonths: 6,
      approvedAt: new Date("2026-08-18T03:00:00.000Z"),
    });

    expect(installments.map((item) => item.recognizedAmountKrw))
      .toEqual([19_900, 0, 0, 0, 0, 0]);
    expect(installments.map((item) => item.commissionAmountKrw))
      .toEqual([3_980, 0, 0, 0, 0, 0]);
  });

  it.each([
    { amountKrw: 70_965, recognitionMonths: 3 },
    { amountKrw: 198_000, recognitionMonths: 12 },
  ])("creates all $recognitionMonths prepaid installments", (input) => {
    const installments = calculateReferralCommissionInstallments({
      ...input,
      refundedAmountKrw: 0,
      commissionRateBps: 2_000,
      approvedAt: new Date("2026-08-18T03:00:00.000Z"),
    });

    expect(installments).toHaveLength(input.recognitionMonths);
    expect(installments.reduce((sum, item) => sum + item.grossAmountKrw, 0))
      .toBe(input.amountKrw);
    expect(installments.reduce((sum, item) => sum + item.commissionAmountKrw, 0))
      .toBe(Math.floor(input.amountKrw * 0.2));
  });

  it("zeros every installment after a full refund", () => {
    const installments = calculateReferralCommissionInstallments({
      amountKrw: 119_400,
      refundedAmountKrw: 119_400,
      commissionRateBps: 2_000,
      recognitionMonths: 6,
      approvedAt: new Date("2026-08-18T03:00:00.000Z"),
    });

    expect(installments.every((item) => item.recognizedAmountKrw === 0)).toBe(true);
    expect(installments.every((item) => item.commissionAmountKrw === 0)).toBe(true);
  });

  it("preserves the original KST billing day across short months", () => {
    const approvedAt = new Date("2028-01-31T03:30:00.000Z");
    expect(addReferralKstMonths(approvedAt, 1).toISOString())
      .toBe("2028-02-29T03:30:00.000Z");
    expect(addReferralKstMonths(approvedAt, 2).toISOString())
      .toBe("2028-03-31T03:30:00.000Z");
  });

  it("normalizes campaigns and masks member emails", () => {
    expect(normalizeReferralCampaign(" youtube-01 ")).toBe("youtube-01");
    expect(normalizeReferralCampaign("not valid")).toBeNull();
    expect(maskedReferralEmail("creator@example.com")).toBe("cr*****@example.com");
  });
});
