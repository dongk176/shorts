import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const migration = source("../../supabase/migrations/202608250003_enterprise_payment_requests.sql");
const adminRoute = source("../app/api/admin/managed-accounts/[accountId]/payment-requests/route.ts");
const prepareRoute = source("../app/api/enterprise-pay/[token]/items/[itemId]/prepare/route.ts");
const confirmRoute = source("../app/api/enterprise-pay/[token]/attempts/[attemptId]/confirm/route.ts");
const publicClient = source("../app/enterprise-pay/[token]/payment-client.tsx");

describe("enterprise payment safety invariants", () => {
  it("keeps public payment tables server-only and capability-token protected", () => {
    expect(migration).toContain("public_token uuid not null default gen_random_uuid() unique");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on shorts_mvp.enterprise_payment_requests from anon, authenticated");
    expect(prepareRoute).toContain("payment_request.public_token=${token}");
    expect(confirmRoute).toContain("payment_request.public_token=${token}");
  });

  it("allows payment requests only for enterprise issued accounts", () => {
    expect(adminRoute).toContain('account.accountType !== "enterprise"');
    expect(adminRoute).toContain("기업 계정에만 결제를 요청할 수 있습니다.");
  });

  it("creates a fresh order id for retries and blocks concurrent live attempts", () => {
    expect(migration).toContain("enterprise_payment_attempts_one_live_per_item_idx");
    expect(migration).toContain("where status in ('prepared','confirming','manual_review')");
    expect(prepareRoute).toContain('`ent_${randomUUID().replaceAll("-", "")}`');
  });

  it("verifies order, amount, normal-payment type, and card method before fulfillment", () => {
    expect(confirmRoute).toContain("input.orderId !== attempt.orderId");
    expect(confirmRoute).toContain("input.amount !== Number(attempt.amountKrw)");
    expect(confirmRoute).toContain('payment.type !== "NORMAL"');
    expect(confirmRoute).toContain('payment.method !== "카드"');
    expect(confirmRoute).toContain('status=\'manual_review\'');
  });

  it("opens only the card payment method in the customer flow", () => {
    expect(publicClient).toContain('paymentMethod.code !== "CARD"');
    expect(publicClient).toContain("각 항목은 별도 카드 승인으로 처리됩니다.");
  });
});
