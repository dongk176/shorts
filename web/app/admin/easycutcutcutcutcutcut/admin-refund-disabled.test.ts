import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(
  new URL("./admin-billing-dashboard.tsx", import.meta.url),
  "utf8",
);
const manualReviewRoute = readFileSync(
  new URL("../../api/admin/billing/manual-reviews/route.ts", import.meta.url),
  "utf8",
);
const directRefundRoute = new URL(
  "../../api/admin/billing/refunds/route.ts",
  import.meta.url,
);

describe("admin payment refund controls", () => {
  it("does not expose a direct refund action in the billing dashboard", () => {
    expect(dashboard).not.toContain("/api/admin/billing/refunds");
    expect(dashboard).not.toContain("환불 실행");
    expect(dashboard).not.toContain("승인 확인 후 전액취소");
    expect(dashboard).toContain("PG에서 직접 처리");
  });

  it("does not expose a server route that can execute an admin refund", () => {
    expect(existsSync(directRefundRoute)).toBe(false);
    expect(manualReviewRoute).not.toContain("refundThePayOnePayment");
    expect(manualReviewRoute).not.toContain("refund_approved");
    expect(manualReviewRoute).toContain('action: z.literal("no_approval")');
  });
});
