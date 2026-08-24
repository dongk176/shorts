import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202608190001_referral_monthly_commissions.sql",
    import.meta.url,
  ),
  "utf8",
);
const createPayoutRoute = readFileSync(
  new URL(
    "../app/api/admin/referrals/[partnerId]/payouts/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const finalizePayoutRoute = readFileSync(
  new URL(
    "../app/api/admin/referrals/payouts/[payoutId]/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const partnerDashboardPage = readFileSync(
  new URL("../app/partner/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const commissionCsvRoute = readFileSync(
  new URL("../app/api/partner/commissions.csv/route.ts", import.meta.url),
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

describe("referral monthly payout flow", () => {
  it("limits drafts to unlocked installments in the selected KST period", () => {
    expect(createPayoutRoute).toContain("referral_commission_installments");
    expect(createPayoutRoute).toContain("at time zone 'Asia/Seoul'");
    expect(createPayoutRoute).toContain("between ${body.periodStart}::date and ${body.periodEnd}::date");
    expect(createPayoutRoute).toContain("referral_payout_items");
    expect(createPayoutRoute).toContain("Math.min(");
  });

  it("rechecks refunds and releases allocations when a draft is canceled", () => {
    expect(finalizePayoutRoute).toContain("itemPayable");
    expect(finalizePayoutRoute).toContain("globalPayable");
    expect(finalizePayoutRoute).toContain("PAYOUT_BALANCE_REVERSED");
    expect(finalizePayoutRoute).toContain("delete from shorts_mvp.referral_payout_items");
  });

  it("shows and exports one row per monthly installment", () => {
    expect(partnerDashboardPage).toContain("installment.installment_number");
    expect(partnerDashboardPage).toContain("installment.earned_at");
    expect(commissionCsvRoute).toContain('"회차","전체회차"');
    expect(commissionCsvRoute).toContain('"월별수익금액","상태","정산가능일"');
  });
});
