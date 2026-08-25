import { describe, expect, it } from "vitest";
import {
  calculateEnterpriseServiceEndDate,
  enterprisePeriodRelation,
  kstExclusiveEndInstant,
  kstStartInstant,
  validateEnterpriseItemSequence,
} from "@/lib/enterprise-contract";

describe("enterprise contract periods", () => {
  it("counts day periods inclusively", () => {
    expect(calculateEnterpriseServiceEndDate({
      serviceStartDate: "2026-08-26",
      durationValue: 7,
      durationUnit: "days",
    })).toBe("2026-09-01");
  });

  it("ends a month period on the day before the anniversary", () => {
    expect(calculateEnterpriseServiceEndDate({
      serviceStartDate: "2026-08-26",
      durationValue: 1,
      durationUnit: "months",
    })).toBe("2026-09-25");
  });

  it("clamps month-end and handles leap years", () => {
    expect(calculateEnterpriseServiceEndDate({
      serviceStartDate: "2026-01-31",
      durationValue: 1,
      durationUnit: "months",
    })).toBe("2026-02-28");
    expect(calculateEnterpriseServiceEndDate({
      serviceStartDate: "2028-01-31",
      durationValue: 1,
      durationUnit: "months",
    })).toBe("2028-02-29");
  });

  it("uses KST midnight and an exclusive next-day end", () => {
    expect(kstStartInstant("2026-08-26").toISOString()).toBe("2026-08-25T15:00:00.000Z");
    expect(kstExclusiveEndInstant("2026-09-01").toISOString()).toBe("2026-09-01T15:00:00.000Z");
  });

  it("rejects a later item whose start date goes backwards", () => {
    expect(() => validateEnterpriseItemSequence([
      {
        name: "첫 상품",
        serviceStartDate: "2026-09-01",
        durationValue: 1,
        durationUnit: "months",
        includedMinutes: 60,
        amountKrw: 1000,
        vatTreatment: "included",
        paymentDueDate: "2026-08-30",
      },
      {
        name: "둘째 상품",
        serviceStartDate: "2026-08-31",
        durationValue: 1,
        durationUnit: "days",
        includedMinutes: 60,
        amountKrw: 1000,
        vatTreatment: "included",
        paymentDueDate: "2026-08-31",
      },
    ])).toThrow("이전 상품보다 빠를 수 없습니다");
  });

  it("detects overlaps and gaps", () => {
    expect(enterprisePeriodRelation(
      { serviceEndDate: "2026-09-10" },
      { serviceStartDate: "2026-09-10" },
    )).toBe("overlap");
    expect(enterprisePeriodRelation(
      { serviceEndDate: "2026-09-10" },
      { serviceStartDate: "2026-09-12" },
    )).toBe("gap");
  });
});
