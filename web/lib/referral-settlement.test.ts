import { describe, expect, it } from "vitest";
import { buildReferralSettlements, defaultReferralMonth, emptyReferralMonth, referralMonthPeriod,
  resolveSettlementMonth, type ReferralSettlementPayout, type ReferralSettlementMonth } from "./referral-settlement";

const now = new Date("2026-10-10T00:00:00+09:00");
const month = (month: string, commissionKrw: number): ReferralSettlementMonth => ({
  ...emptyReferralMonth(month), commissionKrw, confirmedSalesKrw: commissionKrw * 5,
});
const paid = (month: string, amountKrw: number): ReferralSettlementPayout => ({
  id: month, month, amountKrw, status: "paid", paidAt: now.toISOString(), snapshot: null,
});
describe("referral calendar settlement", () => {
  it("maps calendar months, leap February and year rollover to the next 10th", () => {
    expect(referralMonthPeriod("2024-02")).toEqual({ periodStart: "2024-02-01", periodEnd: "2024-02-29", scheduledPaymentDate: "2024-03-10" });
    expect(referralMonthPeriod("2026-12").scheduledPaymentDate).toBe("2027-01-10");
    expect(() => referralMonthPeriod("2026-13")).toThrow();
    expect(() => referralMonthPeriod("2026-2")).toThrow();
  });
  it("changes the default month at Korean midnight", () => {
    expect(defaultReferralMonth(new Date("2026-09-30T14:59:59Z"))).toBe("2026-08");
    expect(defaultReferralMonth(new Date("2026-09-30T15:00:00Z"))).toBe("2026-09");
  });
  it("accepts old complete-month inputs but rejects arbitrary or conflicting intervals", () => {
    expect(resolveSettlementMonth({ periodStart: "2026-08-01", periodEnd: "2026-08-31" })).toBe("2026-08");
    for (const input of [{ periodStart: "2026-08-02", periodEnd: "2026-08-31" },
      { settlementMonth: "2026-08", periodEnd: "2026-09-01" }, { periodStart: "2026-08-01" }]) {
      expect(() => resolveSettlementMonth(input)).toThrow();
    }
  });
  it("does not permit paying a matured September installment in September", () => {
    const [row] = buildReferralSettlements([month("2026-09", 3960)], [], new Date("2026-09-20T00:00:00+09:00"));
    expect(row.payableNow).toBe(false);
    expect(row.scheduledPaymentDate).toBe("2026-10-10");
  });
  it("unlocks at the 10th Korean midnight and marks overdue only the following day", () => {
    const rows = [month("2026-09", 100)];
    expect(buildReferralSettlements(rows, [], new Date("2026-10-09T14:59:59Z"))[0].payableNow).toBe(false);
    expect(buildReferralSettlements(rows, [], now)[0]).toMatchObject({ payableNow: true, overdue: false });
    expect(buildReferralSettlements(rows, [], new Date("2026-10-10T15:00:00Z"))[0].overdue).toBe(true);
  });
  it("keeps older unpaid amounts in their own month", () => {
    const rows = buildReferralSettlements([month("2026-07", 3980), month("2026-08", 7528)], [], now);
    expect(rows.map((row) => row.payableKrw)).toEqual([7528, 3980]);
  });
  it("absorbs refund debt oldest first, carries excess and never borrows future earnings", () => {
    const months = [month("2026-07", 0), month("2026-08", 60), month("2026-09", 70), month("2026-10", 900)];
    const rows = buildReferralSettlements(months, [paid("2026-07", 100)], now);
    expect(rows.find((r) => r.month === "2026-08")).toMatchObject({ payableKrw: 0, refundAdjustmentKrw: 60 });
    expect(rows.find((r) => r.month === "2026-09")).toMatchObject({ payableKrw: 30, refundAdjustmentKrw: 40 });
    expect(rows.find((r) => r.month === "2026-10")).toMatchObject({ payableNow: false, refundAdjustmentKrw: 0 });
    const after = buildReferralSettlements(months, [paid("2026-07", 100), paid("2026-09", 30)], new Date("2026-11-10T00:00:00+09:00"));
    expect(after.find((r) => r.month === "2026-10")?.payableKrw).toBe(900);
  });
  it("does not deduct an adjustment twice after a net payout", () => {
    const rows = buildReferralSettlements([month("2026-07", 60), month("2026-08", 100), month("2026-09", 100)],
      [paid("2026-07", 100), paid("2026-08", 60)], now);
    expect(rows.find((r) => r.month === "2026-09")).toMatchObject({ payableKrw: 100, refundAdjustmentKrw: 0 });
  });
  it("preserves prepared cash and flags changed refunds", () => {
    const p = { ...paid("2026-08", 100), status: "draft" as const };
    const [row] = buildReferralSettlements([month("2026-08", 60)], [p], now);
    expect(row).toMatchObject({ payableKrw: 100, draftChanged: true, currentPayableKrw: 60 });
  });
});
