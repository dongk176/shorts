import fs from "node:fs";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => sql }));
vi.mock("@/lib/partner-auth", () => ({ requirePartnerSession: async () => ({ partnerId }) }));
import { prepareReferralPayout, finalizeReferralPayout } from "./referral-payout-service";
import { loadReferralSettlements, loadReferralSettlementTransactions } from "./referral-settlement-server";
import { GET as downloadCsv } from "../app/api/partner/commissions.csv/route";

const url = process.env.REFERRAL_TEST_DATABASE_URL;
let sql: Sql;
let partnerId: string;
let userId: string;
const now = new Date("2026-09-10T12:00:00+09:00");
const migration = (file: string) => fs.readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");

describe.skipIf(!url)("referral calendar PostgreSQL integration", () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/referral_test") {
      throw new Error("Integration tests require an isolated local referral_test database");
    }
    sql = postgres(url!, { max: 4, prepare: false, transform: postgres.camel, onnotice: () => {},
      connection: { statement_timeout: 10000, lock_timeout: 3000 } });
    await sql.unsafe(`drop schema if exists shorts_mvp cascade;
      create schema shorts_mvp;
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      end $$;
      create function shorts_mvp.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
      create table shorts_mvp.app_users(id uuid primary key default gen_random_uuid(),email text,created_at timestamptz default now());
      create table shorts_mvp.plans(code text primary key,prepaid_months integer);
      insert into shorts_mvp.plans values('monthly',1),('package',3);
      create table shorts_mvp.billing_orders(id uuid primary key default gen_random_uuid(),user_id uuid references shorts_mvp.app_users(id),
        amount_krw integer not null,refunded_amount_krw integer not null default 0,status text not null,
        approved_at timestamptz,product_code text,billing_cycle text);`);
    const migrationConnection = await sql.reserve();
    try {
    for (const name of ["202607280002_referral_partner_revenue.sql", "202608190001_referral_monthly_commissions.sql", "202609100002_referral_calendar_payouts.sql"]) {
      await migrationConnection.unsafe(migration(name));
    }
    } finally { migrationConnection.release(); }
  });
  beforeEach(async () => {
    await sql`truncate shorts_mvp.app_users,shorts_mvp.referral_partners cascade`;
    userId = randomUUID(); partnerId = randomUUID();
    await sql`insert into shorts_mvp.app_users(id,email) values(${userId},'test@example.invalid')`;
    await sql`insert into shorts_mvp.referral_partners(id,create_request_id,creator_name,slug,account_number_ciphertext,account_number_last4)
      values(${partnerId},${randomUUID()},'Test partner','test-partner','local-test-only','1234')`;
    await sql`update shorts_mvp.app_users set referral_partner_id=${partnerId},referral_attributed_at=now() where id=${userId}`;
  });
  afterAll(async () => { if (sql) await sql.end({ timeout: 3 }); });
  const order = async (amount = 10000, approvedAt = "2026-08-31T23:59:59+09:00", packagePlan = false) => {
    const [row] = await sql`insert into shorts_mvp.billing_orders(user_id,amount_krw,status,approved_at,product_code,billing_cycle)
      values(${userId},${amount},'succeeded',${approvedAt},${packagePlan ? "package" : "monthly"},${packagePlan ? "yearly" : "monthly"}) returning id`;
    return String(row.id);
  };
  const prepare = (month = "2026-08", requestId = randomUUID(), when = now) => sql.begin((tx) => prepareReferralPayout(tx, {
    partnerId, actorId: userId, month, requestId, now: when,
  }));
  const pay = (id: string, amount: number, when = now, requestId = randomUUID()) => sql.begin((tx) => finalizeReferralPayout(tx, {
    payoutId: id, actorId: userId, requestId, action: "paid", confirmedAmountKrw: amount,
    transferReference: "local-test-transfer", now: when,
  }));
  const ledger = async (when = now) => (await loadReferralSettlements({ partnerId, now: when }))[0].months;

  it("applies all real migrations, keeps read paths read-only, and matures exactly after 168 hours", async () => {
    await order();
    const before = await ledger(new Date("2026-09-07T23:59:58+09:00"));
    expect(before[0]).toMatchObject({ confirmedSalesKrw: 0, waitingSalesKrw: 10000, payableNow: false });
    const after = await ledger(new Date("2026-09-07T23:59:59+09:00"));
    expect(after[0]).toMatchObject({ confirmedSalesKrw: 10000, waitingSalesKrw: 0, payableNow: false });
    expect((await ledger())[0]).toMatchObject({ payableNow: true, payableKrw: 2000, scheduledPaymentDate: "2026-09-10" });
    expect(Number((await sql`select count(*) as n from shorts_mvp.referral_payouts`)[0].n)).toBe(0);
    await expect(prepare("2026-08", randomUUID(), new Date("2026-09-09T23:59:59+09:00"))).rejects.toMatchObject({ code: "PAYOUT_NOT_DUE" });
  });
  it("serializes duplicate requests and rejects a second payout for the same month", async () => {
    await order();
    const request = randomUUID();
    const results = await Promise.all([prepare("2026-08", request), prepare("2026-08", request)]);
    expect(new Set(results.map((r) => r.payoutId)).size).toBe(1);
    expect(results.filter((r) => r.alreadyProcessed)).toHaveLength(1);
    await expect(prepare("2026-07", request)).rejects.toMatchObject({ status: 409 });
    await expect(prepare()).rejects.toMatchObject({ code: "PAYOUT_PERIOD_DUPLICATE" });
    const id = String(results[0].payoutId);
    const paidRequest = randomUUID();
    const paidResults = await Promise.all([pay(id, 2000, now, paidRequest), pay(id, 2000, now, paidRequest)]);
    expect(paidResults.filter((r) => r.alreadyProcessed)).toHaveLength(1);
    expect((await ledger())[0]).toMatchObject({ status: "paid", payableKrw: 2000 });
  });
  it("preserves one paid month and cancels the remaining package installments after a refund", async () => {
    const id = await order(30000, "2026-08-01T12:00:00+09:00", true);
    const payout = await prepare();
    await pay(String(payout.payoutId), 2000);
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=20000 where id=${id}`;
    const rows = await ledger(new Date("2026-11-10T12:00:00+09:00"));
    expect(rows.find((r) => r.month === "2026-08")).toMatchObject({ status: "paid", payableKrw: 2000, commissionKrw: 2000 });
    expect(rows.filter((r) => r.month !== "2026-08").every((r) => r.payableKrw === 0)).toBe(true);
  });
  it("keeps actual transfer cash after a refund and deducts the debt only once", async () => {
    const id = await order();
    const payout = await prepare();
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=10000 where id=${id}`;
    expect((await ledger())[0]).toMatchObject({ draftChanged: true, payableKrw: 2000, currentPayableKrw: 0 });
    await expect(pay(String(payout.payoutId), 1)).rejects.toMatchObject({ code: "PAYOUT_AMOUNT_MISMATCH" });
    await pay(String(payout.payoutId), 2000);
    await order(20000, "2026-09-01T12:00:00+09:00");
    const october = new Date("2026-10-10T12:00:00+09:00");
    expect((await ledger(october)).find((r) => r.month === "2026-09")).toMatchObject({ commissionKrw: 4000, refundAdjustmentKrw: 2000, payableKrw: 2000 });
    const next = await prepare("2026-09", randomUUID(), october);
    await pay(String(next.payoutId), 2000, october);
    await order(20000, "2026-10-01T12:00:00+09:00");
    expect((await ledger(new Date("2026-11-10T12:00:00+09:00"))).find((r) => r.month === "2026-10")).toMatchObject({ payableKrw: 4000, refundAdjustmentKrw: 0 });
    const details = await loadReferralSettlementTransactions(partnerId, "2026-08", october);
    expect(details[0]).toMatchObject({ recognizedAmountKrw: 10000, commissionAmountKrw: 2000 });
  });
  it("releases canceled preparation and snapshots the current refund-adjusted quote", async () => {
    const id = await order();
    const payout = await prepare();
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=5000 where id=${id}`;
    await sql.begin((tx) => finalizeReferralPayout(tx, { payoutId: String(payout.payoutId), actorId: userId, requestId: randomUUID(), action: "canceled", now }));
    const next = await prepare();
    expect(next.amountKrw).toBe(1000);
    const [total] = await sql`select sum(amount_krw) as amount from shorts_mvp.referral_payout_items`;
    expect(Number(total.amount)).toBe(1000);
  });
  it("uses stored rates, preserves floor rounding, and isolates partner queries", async () => {
    await order(9999);
    await sql`update shorts_mvp.referral_partners set commission_rate_bps=1000 where id=${partnerId}`;
    await order(9999);
    expect((await ledger())[0].commissionKrw).toBe(1999 + 999);
    expect(await loadReferralSettlements({ partnerId: randomUUID(), now })).toEqual([]);
    expect(await loadReferralSettlementTransactions(randomUUID(), "2026-08", now)).toEqual([]);
    const response = await downloadCsv(new NextRequest(`http://localhost/api/partner/commissions.csv?month=2026-08&partnerId=${randomUUID()}`));
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(csv).toContain('"2026-09-10"');
    expect(csv).toContain('"월정산","2026-08"');
    expect(csv).toContain('"19998","0","0","2998","0","2998"');
    const invalid = await downloadCsv(new NextRequest("http://localhost/api/partner/commissions.csv?from=2026-08-02&to=2026-08-31"));
    expect(invalid.status).toBe(400);
  });
});
