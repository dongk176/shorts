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
      create table shorts_mvp.admin_audit_logs(id uuid primary key default gen_random_uuid(),entity_id text,action text,metadata jsonb default '{}',created_at timestamptz default now());
      create table shorts_mvp.billing_toss_checkout_intents(id uuid primary key default gen_random_uuid(),subscription_id uuid,target_plan_code text,purpose text,status text,created_at timestamptz default now());
      create table shorts_mvp.plans(code text primary key,prepaid_months integer);
      insert into shorts_mvp.plans values('monthly',1),('package',3),('toss_starter_1m',1),('toss_starter_3m',3),('toss_starter_6m',6),('toss_starter_12m',12),('toss_easycut_pro_1m',1);
      create table shorts_mvp.billing_orders(id uuid primary key default gen_random_uuid(),user_id uuid references shorts_mvp.app_users(id),
        amount_krw integer not null,refunded_amount_krw integer not null default 0,status text not null,
        approved_at timestamptz,product_code text,billing_cycle text,provider text,kind text,subscription_id uuid,order_id text);`);
    const migrationConnection = await sql.reserve();
    try {
    for (const name of ["202607280002_referral_partner_revenue.sql", "202608190001_referral_monthly_commissions.sql", "202609100002_referral_calendar_payouts.sql", "202609130003_referral_contract_caps.sql"]) {
      await migrationConnection.unsafe(migration(name));
    }
    } finally { migrationConnection.release(); }
  });
  beforeEach(async () => {
    await sql`truncate shorts_mvp.app_users,shorts_mvp.referral_partners,shorts_mvp.admin_audit_logs,shorts_mvp.billing_toss_checkout_intents cascade`;
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
  const prepaid = async (months = 6, amount = 119400, cycle = "monthly", approvedAt = "2026-08-01T12:00:00+09:00") => {
    await sql`update shorts_mvp.referral_partners set commission_rate_bps=1000 where id=${partnerId}`;
    const subscriptionId = randomUUID();
    const [row] = await sql`insert into shorts_mvp.billing_orders(user_id,amount_krw,status,approved_at,product_code,billing_cycle,provider,kind,subscription_id)
      values(${userId},${amount},'succeeded',${approvedAt},${`toss_starter_${months}m`},${cycle},'toss',${cycle === "yearly" ? "subscription_renewal" : "subscription_initial"},${subscriptionId}) returning id`;
    return { id: String(row.id), subscriptionId };
  };
  const conversion = async (o: { id: string; subscriptionId: string }, refund: number, target = "toss_starter_1m", when = "2026-08-02T12:00:00+09:00") => {
    await sql`insert into shorts_mvp.admin_audit_logs(entity_id,action,metadata,created_at)
      values(${o.subscriptionId},'subscription.support_plan_conversion',${sql.json({newPlanCode: target, plannedRefundKrw: refund, orderId: o.id})},${when})`;
  };
  const installments = async (id: string) => sql`select i.id,i.installment_count,i.installment_number,i.commission_amount_krw,i.recognized_amount_krw
    from shorts_mvp.referral_commission_installments i join shorts_mvp.referral_commissions c on c.id=i.commission_id where c.billing_order_id=${id} order by i.installment_number`;
  it.each([[1,24900],[3,70965],[6,119400],[12,198000]])("recognizes Toss %i months independently of initial/renewal cycle", async (months, amount) => {
    for (const cycle of ["monthly", "yearly"]) {
      const o = await prepaid(months, amount, cycle);
      const rows = await installments(o.id);
      expect(rows).toHaveLength(months);
      expect(rows.reduce((sum, r) => sum + Number(r.commissionAmountKrw), 0)).toBe(Math.floor(amount / 10));
    }
  });
  it("preserves exactly two original months after a mid-contract refund and does not delete IDs", async () => {
    const o=await prepaid(); const before=await installments(o.id);
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=79600 where id=${o.id}`;
    const after=await installments(o.id);
    expect(after.map(r=>Number(r.commissionAmountKrw))).toEqual([1990,1990,0,0,0,0]);
    expect(after.map(r=>r.id)).toEqual(before.map(r=>r.id));
  });
  it.each([[94500,"toss_starter_1m",1990,5000],[109500,"toss_easycut_pro_1m",990,0]])("caps converted entitlement after refund %i", async (refund,target,expected,excluded) => {
    const o=await prepaid(); await conversion(o,refund,target);
    await expect(prepare()).rejects.toMatchObject({code:"REFERRAL_CONTRACT_REVIEW_REQUIRED"});
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=${refund} where id=${o.id}`;
    expect((await installments(o.id)).map(r=>Number(r.commissionAmountKrw))).toEqual([expected,0,0,0,0,0]);
    const [c]=await sql`select recognition_status,excluded_sales_krw from shorts_mvp.referral_commissions where billing_order_id=${o.id}`;
    expect(c).toMatchObject({recognitionStatus:"verified",excludedSalesKrw:excluded});
    expect((await prepare()).amountKrw).toBe(expected);
  });
  it("caps twelve-to-six conversion at the ORIGINAL twelve-month price", async () => {
    const o=await prepaid(12,198000);await conversion(o,78600,"toss_starter_6m");
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=78600,product_code='toss_starter_6m' where id=${o.id}`;
    expect((await installments(o.id)).map(r=>Number(r.commissionAmountKrw))).toEqual([1650,1650,1650,1650,1650,1650,0,0,0,0,0,0]);
  });
  it("holds an unknown product without rolling back the customer's successful payment", async () => {
    const [o]=await sql`insert into shorts_mvp.billing_orders(user_id,amount_krw,status,approved_at,product_code,billing_cycle)
      values(${userId},10000,'succeeded','2026-08-01','unknown','monthly') returning id,status`;
    expect(o.status).toBe("succeeded");
    const [c]=await sql`select recognition_status from shorts_mvp.referral_commissions where billing_order_id=${o.id}`;
    expect(c.recognitionStatus).toBe("review_required");
    await expect(prepare()).rejects.toMatchObject({code:"REFERRAL_CONTRACT_REVIEW_REQUIRED"});
  });
  it("does not change the original contract when the catalog or order product changes", async () => {
    const o=await prepaid();
    await sql`update shorts_mvp.billing_orders set product_code='toss_starter_12m' where id=${o.id}`;
    const [c]=await sql`select original_contract,recognition_status from shorts_mvp.referral_commissions where billing_order_id=${o.id}`;
    expect(c.originalContract).toMatchObject({productCode:"toss_starter_6m",months:6,amountKrw:119400});
    expect(c.recognitionStatus).toBe("review_required");
  });
  it("rechecks conversion evidence in the database guard even for an old client", async () => {
    const o=await prepaid();await conversion(o,94500);
    await expect(sql`insert into shorts_mvp.referral_payouts(request_id,partner_id,period_start,period_end,commission_cutoff_at,amount_krw)
      values(${randomUUID()},${partnerId},'2026-08-01','2026-08-31',now(),11940)`).rejects.toThrow("REFERRAL_CONTRACT_REVIEW_REQUIRED");
  });
  it("keeps paid money immutable and accounts for a later full refund only once", async () => {
    const o=await prepaid();const p=await prepare();await pay(String(p.payoutId),1990);
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=119400,status='canceled' where id=${o.id}`;
    expect((await ledger()).find(r=>r.month==='2026-08')).toMatchObject({status:'paid',payableKrw:1990});
    expect((await installments(o.id)).every(r=>Number(r.commissionAmountKrw)===0)).toBe(true);
  });

  it("backfills an old one-row Toss ledger from its checkout, preserves IDs and is idempotent", async () => {
    const o=await prepaid(); const originalRows=await installments(o.id);
    await sql`insert into shorts_mvp.billing_toss_checkout_intents(subscription_id,target_plan_code,purpose,status,created_at)
      values(${o.subscriptionId},'toss_starter_6m','subscription_start','succeeded','2026-08-01T11:00:00+09:00')`;
    await sql`delete from shorts_mvp.referral_commission_installments where commission_id=(select id from shorts_mvp.referral_commissions where billing_order_id=${o.id}) and installment_number>1`;
    await sql`update shorts_mvp.referral_commissions set original_contract='{}',recognition_months=1,eligible_installment_count=0,commission_amount_krw=11940 where billing_order_id=${o.id}`;
    const [first]=await sql`select shorts_mvp.reconcile_referral_contracts() as n`;
    expect(Number(first.n)).toBe(1);
    const rows=await installments(o.id);
    expect(rows).toHaveLength(6);expect(rows[0].id).toBe(originalRows[0].id);
    expect(rows.map(r=>Number(r.commissionAmountKrw))).toEqual([1990,1990,1990,1990,1990,1990]);
    const [second]=await sql`select shorts_mvp.reconcile_referral_contracts() as n`;
    expect(Number(second.n)).toBe(0);
  });
  it("refuses historical backfill if cash has since been prepared", async () => {
    await prepaid();await prepare();
    await expect(sql`select shorts_mvp.reconcile_referral_contracts()`).rejects.toThrow("Reconcile existing cash");
  });
  it("serializes a refund with payout preparation and never prepares stale money", async () => {
    const o=await prepaid();
    let locked!:()=>void; let release!:()=>void;
    const ready=new Promise<void>(resolve=>{locked=resolve;});
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const refund=sql.begin(async tx=>{
      await tx`update shorts_mvp.billing_orders set refunded_amount_krw=119400 where id=${o.id}`;
      locked();await gate;
    });
    await ready;
    const preparation=prepare().then(value=>({value,error:null}),error=>({value:null,error}));
    release();await refund;
    expect((await preparation).error).toMatchObject({code:"NO_PAYOUT_BALANCE"});
  });
  it.each([
    {plannedRefundKrw:-1},
    {plannedRefundKrw:94500,retainedAmountKrw:9900},
    {plannedRefundKrw:94500,targetContractMonths:6},
  ])("holds conflicting conversion evidence: %j", async (evidence) => {
    const o=await prepaid();
    await sql`insert into shorts_mvp.admin_audit_logs(entity_id,action,metadata,created_at)
      values(${o.id},'subscription.support_plan_conversion',${sql.json({newPlanCode:'toss_starter_1m',...evidence})},'2026-08-02')`;
    const [c]=await sql`select recognition_status,recognition_reason from shorts_mvp.referral_commissions where billing_order_id=${o.id}`;
    expect(c).toMatchObject({recognitionStatus:'review_required',recognitionReason:'conversion_evidence_invalid'});
  });
  it("holds malformed conversion data without aborting financial confirmation", async () => {
    const o=await prepaid();
    await sql`insert into shorts_mvp.admin_audit_logs(entity_id,action,metadata,created_at)
      values(${o.id},'subscription.support_plan_conversion',${sql.json({newPlanCode:'toss_starter_1m',newPeriodEnd:'not-a-date',plannedRefundKrw:94500})},'2026-08-02')`;
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=94500 where id=${o.id}`;
    const [c]=await sql`select recognition_status,recognition_reason from shorts_mvp.referral_commissions where billing_order_id=${o.id}`;
    expect(c).toMatchObject({recognitionStatus:'review_required',recognitionReason:'conversion_evidence_invalid'});
  });
  it("includes contract caps and review explanations in CSV without changing the summary total", async () => {
    const o=await prepaid();await conversion(o,94500);
    await sql`update shorts_mvp.billing_orders set refunded_amount_krw=94500 where id=${o.id}`;
    const response=await downloadCsv(new NextRequest('http://localhost/api/partner/commissions.csv?month=2026-08'));
    const csv=await response.text();
    expect(csv).toContain('"원계약개월","유지회차"');
    expect(csv).toContain('"toss_starter_6m","6","1","19900","5000","verified"');
    const row=(await ledger())[0];
    expect(row).toBeDefined();
    expect((await ledger()).find(r=>r.month==='2026-08')).toMatchObject({commissionKrw:1990,excludedSalesKrw:5000});
  });

});
