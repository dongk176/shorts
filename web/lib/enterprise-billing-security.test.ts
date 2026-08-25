import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_PURCHASE_TERMS_HASH,
  ENTERPRISE_REFUND_POLICY_HASH,
} from "@/lib/enterprise-contract";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("enterprise billing safety contract", () => {
  it("pins the consent snapshot to the exact v1 legal documents", () => {
    expect(hash(source("web/content/enterprise/purchase-terms-v1.md")))
      .toBe(ENTERPRISE_PURCHASE_TERMS_HASH);
    expect(hash(source("web/content/enterprise/refund-policy-v1.md")))
      .toBe(ENTERPRISE_REFUND_POLICY_HASH);
  });

  it("keeps personal reservation logic unchanged and adds an enterprise-only function", () => {
    const migration = source("supabase/migrations/202608260001_enterprise_billing_contracts.sql");
    expect(migration).toContain("create or replace function shorts_mvp.reserve_enterprise_usage_grants");
    expect(migration).not.toContain("create or replace function shorts_mvp.reserve_usage_grants");
    expect(migration).toContain("'toss_enterprise_billing',false");
    expect(migration).not.toMatch(/\b(?:create|alter|drop|truncate)\s+(?:table|view|function|type|schema)\s+(?:if\s+(?:not\s+)?exists\s+)?public\./i);
  });

  it("authorizes billing requests by both token and logged-in enterprise owner", () => {
    const auth = source("web/lib/enterprise-payment-auth.ts");
    expect(auth).toContain("payment_request.public_token=${token}");
    expect(auth).toContain("managed.app_user_id=${session.userId}");
    expect(auth).toContain("payment_request.payment_mode='billing'");
  });

  it("charges only the stored current item and never accepts a browser amount", () => {
    const charge = source("web/lib/enterprise-billing-charge.ts");
    const route = source("web/app/api/enterprise-pay/[token]/billing/items/[itemId]/charge/route.ts");
    expect(charge).toContain("item.amount_krw");
    expect(charge).toContain("sort_order<${row.sortOrder} and status<>'paid'");
    expect(charge).toContain("payment_request.public_token=${input.token}");
    expect(charge).toContain("for update of payment_request,item");
    expect(charge).toContain("idempotencyKey: `enterprise-charge-${prepared.attemptId}`");
    expect(route).not.toContain("amount");
  });

  it("claims a card-registration callback before issuing a billing key", () => {
    const migration = source("supabase/migrations/202608260001_enterprise_billing_contracts.sql");
    const complete = source("web/app/api/enterprise-pay/[token]/billing/registration/complete/route.ts");
    expect(migration).toContain("'prepared','issuing','issued','failed','expired','manual_review'");
    expect(complete).toContain("for update of intent,profile");
    expect(complete).toContain("set status='issuing'");
  });

  it("requires every individual consent before recording the immutable snapshot", () => {
    const migration = source("supabase/migrations/202608260001_enterprise_billing_contracts.sql");
    const consent = source("web/app/api/enterprise-pay/[token]/consent/route.ts");
    expect(migration).toContain("purchase_terms_agreed and refund_policy_agreed and stored_card_charge_agreed");
    expect(consent).toContain("purchaseTermsAgreed: z.literal(true)");
    expect(consent).toContain("refundPolicyAgreed: z.literal(true)");
    expect(consent).toContain("storedCardChargeAgreed: z.literal(true)");
  });
});
