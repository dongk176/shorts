import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  effectiveRemediationState,
  hasKstBillingDateStarted,
  kstDateKey,
} from "./billing-payment-method-remediation";

const confirmRoute = readFileSync(
  new URL("../app/api/billing/payment-method-remediations/[remediationId]/confirm/route.ts", import.meta.url),
  "utf8",
);
const gate = readFileSync(
  new URL("../components/payment-method-remediation-gate.tsx", import.meta.url),
  "utf8",
);
const webhook = readFileSync(
  new URL("../app/api/webhooks/thepayone/[secret]/route.ts", import.meta.url),
  "utf8",
);
const renewals = readFileSync(
  new URL("./billing-renewals.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../../supabase/migrations/202608120001_legacy_recurring_card_remediation.sql", import.meta.url),
  "utf8",
);

describe("legacy recurring-card remediation", () => {
  it("uses the KST calendar date, not the UTC instant, to close registration", () => {
    const originalCharge = new Date("2026-08-24T15:30:00.000Z");
    expect(kstDateKey(originalCharge)).toBe("2026-08-25");
    expect(hasKstBillingDateStarted(
      originalCharge,
      new Date("2026-08-24T14:59:59.999Z"),
    )).toBe(false);
    expect(hasKstBillingDateStarted(
      originalCharge,
      new Date("2026-08-24T15:00:00.000Z"),
    )).toBe(true);
    expect(effectiveRemediationState({
      state: "required",
      originalNextChargeAt: originalCharge,
    }, new Date("2026-08-24T15:00:00.000Z"))).toBe("awaiting_provider");
  });

  it("registers a 9,900 won recurring card without invoking a payment", () => {
    expect(confirmRoute).toContain("registerThePayOneCard({");
    expect(confirmRoute).toContain("amount: LEGACY_CARD_EXPECTED_AMOUNT_KRW");
    expect(confirmRoute).toContain("billingDay,");
    expect(confirmRoute).not.toContain("chargeThePayOneCard");
    expect(confirmRoute).not.toContain('thePayOnePost("/api/pay"');
    expect(confirmRoute).toContain("'payment_method_update'");
    expect(confirmRoute).toContain("'monthly',0,");
  });

  it("never accepts the plan, amount, or billing day from the browser", () => {
    const schemaSource = confirmRoute.slice(
      confirmRoute.indexOf("const schema"),
      confirmRoute.indexOf("type Claim"),
    );
    expect(schemaSource).not.toContain("amount");
    expect(schemaSource).not.toContain("billingDay");
    expect(schemaSource).not.toContain("planCode");
    expect(confirmRoute).toContain("row.originalNextChargeAt");
    expect(confirmRoute).toContain("row.originalCurrentPeriodEnd");
  });

  it("keeps the required overlay terse and non-dismissible", () => {
    expect(gate).toContain("결제수단 확인이 필요해요");
    expect(gate).toContain("결제수단 추가");
    expect(gate).not.toContain("동의합니다");
    expect(gate).not.toContain("consent");
    expect(gate).not.toContain("onClose");
    expect(gate).toContain('if (event.key === "Escape")');
    expect(gate).toContain("event.preventDefault()");
    expect(gate).toContain('role="alertdialog"');
  });

  it("routes provider evidence into success, zero, wrong-amount, and no-event outcomes", () => {
    expect(webhook).toContain("provider_9900_renewal");
    expect(webhook).toContain("provider_zero_event");
    expect(webhook).toContain("provider_wrong_amount");
    expect(webhook).toContain("event.amount === 0");
    expect(renewals).toContain("provider_no_event");
    expect(renewals).toContain("remediation_expired_no_event");
    expect(renewals).toContain("webhookGraceHours()");
  });

  it("ships disabled feature flags and durable attempt records", () => {
    expect(migration).toContain("billing_payment_method_remediations");
    expect(migration).toContain("billing_payment_method_remediation_attempts");
    expect(migration).toContain("'legacy_recurring_card_claims'");
    expect(migration).toContain("'legacy_recurring_card_reconciliation'");
    expect(migration.match(/false,/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain("issued_card_ciphertext");
  });
});
