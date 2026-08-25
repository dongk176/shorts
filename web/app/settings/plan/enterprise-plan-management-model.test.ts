import { describe, expect, it } from "vitest";
import {
  enterprisePaymentStatusLabel,
  enterpriseProductStage,
  type EnterpriseManagedProduct,
} from "./enterprise-plan-management-model";

const product: EnterpriseManagedProduct = {
  id: "item-1",
  paymentRequestId: "request-1",
  paymentRequestTitle: "UBC 기업 결제",
  paymentRequestToken: "f9361556-6822-496d-ade2-80bae2bef0c8",
  paymentRequestStatus: "paid",
  paymentRequestExpired: false,
  sortOrder: 1,
  name: "EASYCUT 파일럿 이용권",
  amountKrw: 3630,
  paymentStatus: "paid",
  paidAt: "2026-08-26T00:00:00.000Z",
  entitlementGranted: true,
  serviceStartDate: "2026-08-26",
  serviceEndDate: "2026-09-25",
  includedMinutes: 9000,
  vatTreatment: "included",
  paymentDueDate: "2026-08-26",
};

describe("enterprise plan management", () => {
  it("derives active, upcoming and ended service states from the Korean calendar dates", () => {
    expect(enterpriseProductStage(product, "2026-08-26")).toBe("active");
    expect(enterpriseProductStage(product, "2026-09-25")).toBe("active");
    expect(enterpriseProductStage(product, "2026-08-25")).toBe("upcoming");
    expect(enterpriseProductStage(product, "2026-09-26")).toBe("ended");
  });

  it("keeps a paid item locked until every item in its request is paid", () => {
    expect(enterpriseProductStage({
      ...product,
      paymentRequestStatus: "partial",
    }, "2026-08-30")).toBe("payment_required");
  });

  it("distinguishes result review and expired payment requests", () => {
    expect(enterpriseProductStage({
      ...product,
      paymentRequestStatus: "partial",
      paymentStatus: "confirming",
    }, "2026-08-30")).toBe("payment_review");
    expect(enterpriseProductStage({
      ...product,
      paymentRequestStatus: "open",
      paymentStatus: "pending",
      paymentRequestExpired: true,
    }, "2026-08-30")).toBe("payment_expired");
    expect(enterprisePaymentStatusLabel("paid")).toBe("결제 완료");
  });

  it("does not claim service access when fulfillment has not created the entitlement", () => {
    expect(enterpriseProductStage({
      ...product,
      entitlementGranted: false,
    }, "2026-08-30")).toBe("access_pending");
  });
});
