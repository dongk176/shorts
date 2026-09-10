import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202608190001_referral_monthly_commissions.sql",
    import.meta.url,
  ),
  "utf8",
);
describe("referral monthly ledger migration", () => {
  it("creates a private monthly commission and payout-item ledger", () => {
    expect(migration).toContain("shorts_mvp.referral_commission_installments");
    expect(migration).toContain("shorts_mvp.referral_payout_items");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "revoke all on table shorts_mvp.referral_commission_installments from anon, authenticated",
    );
    expect(migration).not.toContain("public.referral_");
  });

  it("snapshots prepaid months and rebuilds refunds from future installments", () => {
    expect(migration).toContain("recognition_months");
    expect(migration).toContain("plan.prepaid_months");
    expect(migration).toContain("net_before := least(net_total,gross_before)");
    expect(migration).toContain("net_after := least(net_total,gross_after)");
    expect(migration).toContain("installment_earned_at+interval '7 days'");
    expect(migration).toContain("referral_add_kst_months");
  });

  it("backfills paid snapshots and reprices only unpaid drafts", () => {
    expect(migration).toContain("where payout.status='paid'");
    expect(migration).toContain("scheduled_commission_amount_krw");
    expect(migration).toContain("referral.payout_monthly_migration_repriced");
    expect(migration).toContain("referral.payout_monthly_migration_canceled");
    expect(migration).not.toMatch(/update shorts_mvp\.referral_payouts\s+set status='draft'/i);
  });
});
