import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/202608210001_toss_billing_runtime_controls.sql", import.meta.url),
  "utf8",
);
const rootVercel = readFileSync(new URL("../../vercel.json", import.meta.url), "utf8");
const successClient = readFileSync(
  new URL("../app/billing/toss/success/success-client.tsx", import.meta.url),
  "utf8",
);
const runtimeAction = readFileSync(
  new URL("../app/admin/easycutcutcutcutcutcut/toss-billing-runtime-actions.ts", import.meta.url),
  "utf8",
);

describe("Toss billing release safeguards", () => {
  it("starts with public assignment and renewals off while preserving internal charges", () => {
    expect(migration).toMatch(/'toss_billing_new_assignments',\s*false/);
    expect(migration).toMatch(/'toss_billing_charges',\s*true/);
    expect(migration).toMatch(/'toss_billing_renewals',\s*false/);
  });

  it("runs abandoned initial checkout reconciliation every five minutes", () => {
    expect(rootVercel).toContain('"path": "/api/cron/toss-checkout-reconciliation"');
    expect(rootVercel).toContain('"schedule": "*/5 * * * *"');
  });

  it("never renders success until the checkout state is explicitly succeeded", () => {
    expect(successClient).toContain('payload.state !== "succeeded"');
    expect(successClient).toContain('payload.state === "reconciliation_required"');
    expect(successClient).toContain("다시 결제하지 마세요");
  });

  it("keeps the successful checkout screen focused on usage and creation", () => {
    expect(successClient).toContain("남은 사용량");
    expect(successClient).toContain("쇼츠 만들기");
    expect(successClient).not.toContain("등록한 카드로 다음 결제일에 자동 결제됩니다.");
  });

  it("turning off approvals also turns off assignments and renewals", () => {
    expect(runtimeAction).toContain("parsed.flag === TOSS_RUNTIME_CHARGES_FLAG && !parsed.enabled");
    expect(runtimeAction).toContain("where flag_key in (");
    expect(runtimeAction).toContain("set enabled=false");
  });
});
