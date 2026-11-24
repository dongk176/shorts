import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import type { Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { processTossBillingRenewals } from "./toss-billing-renewals";
const charge = vi.hoisted(() => vi.fn(() => { throw new Error("No live provider calls in recovery tests"); }));
vi.mock("./toss-billing-config", () => ({ tossBillingSecretKey: () => "test-only" }));
vi.mock("./toss-billing-runtime", () => ({ tossRuntimeRenewalsEnabled: async () => true }));
vi.mock("./toss-billing-ledger", () => ({ executeRecordedTossCharge: charge, reconcileUnknownTossPayment: charge }));
const user = "11111111-1111-4111-8111-111111111111";
const sub = "22222222-2222-4222-8222-222222222222";
const order = "33333333-3333-4333-8333-333333333333";
const txid = "44444444-4444-4444-8444-444444444444";
const method = "55555555-5555-4555-8555-555555555555";
const now = new Date("2026-11-24T00:00:00Z");
let pg: PGlite;
function adapter(db: Pick<PGlite, "query" | "transaction">): Sql {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, "");
    const result = await db.query<Record<string, unknown>>(query, values.map(v => v instanceof Date ? v.toISOString() : v));
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      typeof value === "string" && /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(value) ? new Date(value) : value,
    ])));
  };
  return Object.assign(sql, { begin: (fn: (sql: Sql) => Promise<unknown>) => db.transaction(tx => fn(adapter(tx as unknown as PGlite))) }) as unknown as Sql;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema shorts_mvp;
  create table shorts_mvp.app_users(id uuid primary key,selected_plan_code text);
  create table shorts_mvp.mvp_sessions(user_id uuid,selected_plan_code text);
  create table shorts_mvp.billing_customer_cohorts(user_id uuid primary key,cohort text,provider_customer_key text,source_reason text);
  create table shorts_mvp.user_subscriptions(
    id uuid primary key,user_id uuid,plan_code text,status text,payment_provider text,payment_method_id uuid,
    current_period_start timestamptz,current_period_end timestamptz,next_charge_at timestamptz,next_quota_at timestamptz,
    retry_count int default 0,next_retry_at timestamptz,grace_ends_at timestamptz,cancel_at_period_end boolean default false,
    billing_anchor_day int default 1,scheduled_plan_code text,billing_cycle text,contract_months int,billing_price_krw int,
    scheduled_billing_cycle text,scheduled_contract_months int,scheduled_billing_price_krw int,scheduled_change_effective_at timestamptz,
    canceled_at timestamptz,ended_at timestamptz,last_charge_at timestamptz,last_charge_failure_code text,last_charge_failure_message text,
    provider_schedule_status text,billing_review_status text,billing_review_reason text,last_provider_event_at timestamptz,updated_at timestamptz default now());
  create table shorts_mvp.billing_orders(id uuid primary key,user_id uuid,subscription_id uuid,payment_method_id uuid,product_code text,amount_krw int,
    order_id text,order_name text,status text,renewal_period_start timestamptz,kind text,provider text,approved_at timestamptz,created_at timestamptz default now());
  create table shorts_mvp.billing_toss_transactions(id uuid primary key,user_id uuid,billing_order_id uuid,subscription_id uuid,
    provider_order_id text,transaction_type text,status text,fulfillment_status text,fulfillment_failure_message text,
    fulfilled_at timestamptz,approved_at timestamptz,attempt_no int,next_retry_at timestamptz,failure_code text,failure_message text,
    updated_at timestamptz default now(),created_at timestamptz default now());
  create table shorts_mvp.usage_grants(id uuid default gen_random_uuid(),user_id uuid,subscription_id uuid,billing_order_id uuid,
    kind text,product_code text,total_seconds int check(total_seconds>0),credited_seconds int,carried_seconds int,
    reserved_seconds int default 0,status text default 'active',valid_from timestamptz,expires_at timestamptz,updated_at timestamptz default now());
  create unique index grant_period on shorts_mvp.usage_grants(subscription_id,valid_from,kind) where subscription_id is not null and kind='base';`);
});
beforeEach(async () => {
  charge.mockClear();
  await pg.exec(`truncate shorts_mvp.app_users,shorts_mvp.mvp_sessions,shorts_mvp.billing_customer_cohorts,shorts_mvp.user_subscriptions,shorts_mvp.billing_orders,shorts_mvp.billing_toss_transactions,shorts_mvp.usage_grants;
    insert into shorts_mvp.app_users values('${user}','easycut_pro_v2');
    insert into shorts_mvp.mvp_sessions values('${user}','easycut_pro_v2');
    insert into shorts_mvp.billing_customer_cohorts values('${user}','toss_v1','test-customer','test');
    insert into shorts_mvp.user_subscriptions(id,user_id,plan_code,status,payment_provider,payment_method_id,current_period_start,current_period_end,next_charge_at,next_quota_at)
      values('${sub}','${user}','toss_easycut_pro_1m','active','toss','${method}','2026-10-01','2026-11-01','2026-11-01','2026-11-01');
    insert into shorts_mvp.billing_orders(id,user_id,subscription_id,payment_method_id,product_code,amount_krw,order_id,order_name,status,renewal_period_start,kind,provider)
      values('${order}','${user}','${sub}','${method}','toss_easycut_pro_1m',9900,'EC-REN-test','test','succeeded','2026-11-01','subscription_renewal','toss');
    insert into shorts_mvp.billing_toss_transactions(id,user_id,billing_order_id,subscription_id,provider_order_id,transaction_type,status,fulfillment_status,attempt_no)
      values('${txid}','${user}','${order}','${sub}','EC-REN-test','payment','succeeded','pending',1);`);
});
afterAll(async () => { await pg.close(); });
it("commits quota, ledger fulfillment and subscription period once, then is idempotent", async () => {
  const first = await processTossBillingRenewals(adapter(pg), { now });
  expect(first.renewed).toBe(1);
  await processTossBillingRenewals(adapter(pg), { now });
  expect((await pg.query("select count(*)::int n from shorts_mvp.usage_grants")).rows).toEqual([{ n: 1 }]);
  expect((await pg.query("select status,fulfillment_status from shorts_mvp.billing_toss_transactions")).rows).toEqual([{status:"succeeded",fulfillment_status:"applied"}]);
  expect(charge).not.toHaveBeenCalled();
});
it("recovers the subscription from a committed decline without issuing a new payment", async () => {
  await pg.exec("update shorts_mvp.billing_orders set status='failed';update shorts_mvp.billing_toss_transactions set status='failed',failure_code='REJECT_CARD_PAYMENT'");
  await processTossBillingRenewals(adapter(pg), { now });
  expect((await pg.query("select status,retry_count,last_charge_failure_code from shorts_mvp.user_subscriptions")).rows).toEqual([{status:"past_due",retry_count:1,last_charge_failure_code:"REJECT_CARD_PAYMENT"}]);
  expect((await pg.query("select selected_plan_code from shorts_mvp.app_users")).rows).toEqual([{selected_plan_code:"free"}]);
  expect(charge).not.toHaveBeenCalled();
});
it("keeps canceled approval for explicit settlement review without reviving or granting", async () => {
  await pg.exec("update shorts_mvp.user_subscriptions set status='canceled'");
  expect((await processTossBillingRenewals(adapter(pg), { now })).closedFulfillmentsForReview).toBe(1);
  expect((await processTossBillingRenewals(adapter(pg), { now })).closedFulfillmentsForReview).toBe(0);
  expect((await pg.query("select status,fulfillment_status from shorts_mvp.billing_toss_transactions")).rows).toEqual([{status:"succeeded",fulfillment_status:"manual_review"}]);
  expect((await pg.query("select count(*)::int n from shorts_mvp.usage_grants")).rows).toEqual([{n:0}]);
  expect(charge).not.toHaveBeenCalled();
});
it("rolls back quota expiration when insertion fails and preserves the approved pending payment", async () => {
  await pg.exec(`insert into shorts_mvp.usage_grants(user_id,subscription_id,kind,product_code,total_seconds,valid_from,expires_at) values('${user}','${sub}','base','toss_easycut_pro_1m',3600,'2026-10-01','2026-11-01');
    alter table shorts_mvp.usage_grants add constraint simulated_write_failure check(valid_from<'2026-11-01')`);
  try {
    expect((await processTossBillingRenewals(adapter(pg), { now })).results[0].state).toBe("error");
    expect((await pg.query("select status from shorts_mvp.usage_grants")).rows).toEqual([{status:"active"}]);
    expect((await pg.query("select status,fulfillment_status from shorts_mvp.billing_toss_transactions")).rows).toEqual([{status:"succeeded",fulfillment_status:"pending"}]);
    expect(charge).not.toHaveBeenCalled();
  } finally { await pg.exec("alter table shorts_mvp.usage_grants drop constraint simulated_write_failure"); }
});
it("does not flag an already granted closed order as missing fulfillment", async () => {
  await pg.exec(`update shorts_mvp.user_subscriptions set status='canceled';
    insert into shorts_mvp.usage_grants(user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,valid_from,expires_at)
    values('${user}','${sub}','${order}','base','toss_easycut_pro_1m',18000,'2026-11-01','2026-12-01');`);
  const result = await processTossBillingRenewals(adapter(pg), { now });
  expect(result.closedFulfillmentsForReview).toBe(0);
  expect(charge).not.toHaveBeenCalled();
});
