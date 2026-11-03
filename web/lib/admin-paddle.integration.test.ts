import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { pgliteTestSql } from "./pglite-test-sql";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => sql }));
import { loadAdminBillingOrders, decodeBillingOrderCursor } from "./admin-billing-orders";
import { loadAdminPaddleOrders, loadAdminPaddleSales } from "./admin-paddle";
import { formatAdminCurrency } from "./admin-paddle-contract";
let pg: PGlite;
const sql = pgliteTestSql(()=>pg);
const uid = "00000000-0000-4000-8000-000000000001";
const sid = "00000000-0000-4000-8000-000000000002";
const id = (n: number) => "txn_" + String(n).padStart(26, "0");
const filters = { status: "all", provider: "all", query: "" };
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema shorts_mvp;
  create table shorts_mvp.app_users(id uuid primary key,email text);
  create table shorts_mvp.user_subscriptions(id uuid primary key,status text,plan_code text);
  create table shorts_mvp.plans(code text primary key,prepaid_months integer);
  create table shorts_mvp.billing_orders(id uuid primary key,created_at timestamptz,status text,provider text,user_id uuid,order_id text,provider_transaction_id text,
    kind text,product_code text,billing_cycle text,amount_krw bigint,refunded_amount_krw bigint,refund_status text,provider_status text,failure_code text,failure_message text,
    provider_terminal_id text,installment_months int,payment_method_id uuid,installment_terms_snapshot jsonb,renewal_period_start timestamptz,approved_at timestamptz,refund_policy_version int,subscription_id uuid);
  create table shorts_mvp.billing_payment_methods(id uuid,issuer_name text);
  create table shorts_mvp.subscription_upgrade_refunds(source_order_id uuid,refund_amount_krw bigint,status text);
  create table shorts_mvp.usage_grants(id uuid,product_code text,billing_order_id uuid,kind text);
  create table shorts_mvp.usage_grant_allocations(grant_id uuid,reservation_id uuid,status text,created_at timestamptz);
  create table shorts_mvp.popular_filter_usage_events(billing_order_id uuid,occurred_at timestamptz);
  create table shorts_mvp.ebook_download_counters(user_id uuid,last_downloaded_at timestamptz);
  create table shorts_mvp.usage_reservations(id uuid,job_id uuid,status text);
  create table shorts_mvp.video_jobs(id uuid,status text,completed_at timestamptz,created_at timestamptz);
  create table shorts_mvp.paddle_subscriptions(paddle_id text primary key,user_id uuid,subscription_id uuid,environment text);
  create table shorts_mvp.paddle_payments(transaction_id text primary key,paddle_subscription_id text,user_id uuid,currency text,amount_minor bigint,grant_id uuid,
    period_start timestamptz,period_end timestamptz,created_at timestamptz,plan_code text);
  create table shorts_mvp.paddle_adjustments(id text primary key,transaction_id text,amount_minor bigint,action text,status text);
  insert into shorts_mvp.app_users values('${uid}','admin-test@example.test');
  insert into shorts_mvp.user_subscriptions values('${sid}','active','paddle_pro_12m');
  insert into shorts_mvp.paddle_subscriptions values('sub_live','${uid}','${sid}','live'),('sub_sandbox','${uid}','${sid}','sandbox');`);
  await pg.exec(`create table shorts_mvp.paypal_one_time_orders(id uuid primary key,user_id uuid,subscription_id uuid,plan_code text,status text,capture_id text,amount_minor integer,currency text,refunded_minor integer default 0,reversed boolean default false,entitlement_hold boolean default false,environment text,paid_at timestamptz,access_end timestamptz,created_at timestamptz default now(),last_error_code text);`);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec(`truncate shorts_mvp.paypal_one_time_orders,shorts_mvp.paddle_payments,shorts_mvp.paddle_adjustments,shorts_mvp.billing_orders;`);
});
async function payment(n: number, currency = "JPY", amount = 590, subscription = "sub_live", time = "2026-09-26T15:00:00.123456Z") {
  await pg.query(`insert into shorts_mvp.paddle_payments(transaction_id,paddle_subscription_id,user_id,currency,amount_minor,period_start,period_end,created_at,plan_code)
    values($1,$2,$3,$4,$5,'2026-09-26','2026-10-26',$6,'paddle_lite')`, [id(n), subscription, uid, currency, amount, time]);
}
async function domestic(time = "2026-09-26T15:00:00.123456Z") {
  await pg.query(`insert into shorts_mvp.billing_orders(id,created_at,status,provider,user_id,order_id,kind,product_code,billing_cycle,amount_krw,refunded_amount_krw,refund_status,approved_at)
    values('11111111-1111-4111-8111-111111111111',$1,'succeeded','toss',$2,'domestic-order','subscription','easycut_pro_v2','monthly',9900,0,'none',$1)`, [time,uid]);
}
async function adjustment(name: string, txn: number, amount: number, action: string, status: string) {
  await pg.query(`insert into shorts_mvp.paddle_adjustments values($1,$2,$3,$4,$5)`, [name,id(txn),amount,action,status]);
}
describe("administrator live Paddle ledger", () => {
  it("mixes domestic and live payments, keeps currency minor units and historical purchased plan", async () => {
    await payment(1); await payment(2,"USD",399); await payment(3,"USD",99999,"sub_sandbox"); await domestic();
    const page = await loadAdminBillingOrders({ filters });
    expect(page.orders).toHaveLength(3);
    const yen = page.orders.find((r) => r.id === id(1))!;
    expect(yen).toMatchObject({ provider:"paddle",currency:"JPY",amountMinor:590,amountKrw:0,productCode:"paddle_lite",subscriptionStatus:"active",approvedAt:null });
    expect(page.orders.find((r) => r.provider === "toss")).toMatchObject({ amountKrw:9900,provider:"toss" });
    expect(formatAdminCurrency(399,"USD")).toContain("3.99");
    expect(formatAdminCurrency(590,"JPY")).toContain("590");
    expect(await loadAdminPaddleOrders([id(3)])).toEqual([]);
  });
  it("paginates across ledgers without duplicate or skipped rows including microsecond timestamp ties", async () => {
    for (let n=1;n<=24;n++) await payment(n);
    await domestic();
    const first = await loadAdminBillingOrders({ filters });
    expect(first.orders).toHaveLength(20); expect(first.hasMore).toBe(true);
    expect(decodeBillingOrderCursor(first.nextCursor,filters)?.createdAt).toContain("123456Z");
    const second = await loadAdminBillingOrders({ filters,cursor:first.nextCursor });
    expect(second.orders).toHaveLength(5); expect(second.hasMore).toBe(false);
    expect(new Set([...first.orders,...second.orders].map((r) => r.id)).size).toBe(25);
    const offset = await loadAdminBillingOrders({ filters,offset:20 });
    expect(offset.orders.map(r=>r.id)).toEqual(second.orders.map(r=>r.id));
  });
  it("filters provider, status and email/transaction search consistently", async () => {
    await payment(1); await domestic();
    expect((await loadAdminBillingOrders({ filters:{...filters,provider:"paddle"} })).orders).toHaveLength(1);
    expect((await loadAdminBillingOrders({ filters:{...filters,provider:"toss"} })).orders[0].provider).toBe("toss");
    expect((await loadAdminBillingOrders({ filters:{...filters,status:"failed"} })).orders).toHaveLength(0);
    expect((await loadAdminBillingOrders({ filters:{...filters,query:id(1)} })).orders).toHaveLength(1);
    expect((await loadAdminBillingOrders({ filters:{...filters,query:"ADMIN-TEST"} })).orders).toHaveLength(2);
  });
  it("separates approved refunds, pending/rejected refunds and chargebacks without multiplying sales", async () => {
    await payment(1); await payment(2,"USD",399); await payment(3,"USD",100000,"sub_sandbox");
    await adjustment("refund",1,100,"refund","approved"); await adjustment("pending",1,80,"refund","pending_approval");
    await adjustment("rejected",1,300,"refund","rejected"); await adjustment("cb",1,50,"chargeback","approved");
    await adjustment("warning",1,50,"chargeback_warning","approved");
    const totals = await loadAdminPaddleSales("2026-09-27");
    expect(totals.find(r=>r.currency==="JPY")).toMatchObject({grossMinor:590,refundedMinor:100,pendingRefundMinor:80,chargebackMinor:50,netMinor:440,paidOrders:1,todayGrossMinor:590});
    expect(totals.find(r=>r.currency==="USD")).toMatchObject({grossMinor:399,paidOrders:1});
    const [order] = await loadAdminPaddleOrders([id(1)]);
    expect(order).toMatchObject({ refundStatus:"partial",refundedAmountMinor:100,pendingRefundMinor:80,chargebackMinor:50 });
    await pg.exec("update shorts_mvp.paddle_adjustments set status='reversed' where id='cb'");
    expect((await loadAdminPaddleSales("2026-09-27")).find(r=>r.currency==="JPY")?.chargebackMinor).toBe(0);
  });
  it("uses KST midnight boundaries and includes full refunds in gross history", async () => {
    await payment(1,"JPY",590,"sub_live","2026-09-26T14:59:59.999999Z");
    await payment(2,"JPY",590,"sub_live","2026-09-26T15:00:00Z");
    await payment(3,"JPY",590,"sub_live","2026-09-27T15:00:00Z");
    await adjustment("full",2,590,"refund","approved");
    const yen=(await loadAdminPaddleSales("2026-09-27")).find(r=>r.currency==="JPY");
    expect(yen).toMatchObject({grossMinor:1770,refundedMinor:590,todayGrossMinor:590,todayPaidOrders:1,paidOrders:3});
    expect((await loadAdminPaddleOrders([id(2)]))[0].refundStatus).toBe("full");
  });
});


it("includes confirmed Live PayPal sales in USD without mixing KRW or Sandbox",async()=>{
 vi.stubEnv('PAYPAL_ENABLED','true');vi.stubEnv('PAYPAL_ONE_TIME_ENABLED','true');
 try{
  await payment(8,'USD',399);await domestic();
  await pg.query("insert into shorts_mvp.paypal_one_time_orders(id,user_id,subscription_id,plan_code,status,capture_id,amount_minor,currency,refunded_minor,environment,paid_at,access_end)values('22222222-2222-4222-8222-222222222222',$1,$2,'pro_1m','completed','CAPTURE1234567',1200,'USD',200,'live',now(),now()+interval '1 month'),('33333333-3333-4333-8333-333333333333',$1,$2,'pro_1m','completed','SANDBOX1234567',99900,'USD',0,'sandbox',now(),now()+interval '1 month')",[uid,sid]);
  const page=await loadAdminBillingOrders({filters});expect(page.orders).toHaveLength(3);
  expect(page.orders.find(o=>o.provider==='paypal')).toMatchObject({currency:'USD',amountMinor:1200,refundedAmountMinor:200,amountKrw:0,kind:'일회성 이용권'});
  expect((await loadAdminBillingOrders({filters:{...filters,provider:'paypal'}})).orders).toHaveLength(1);
  expect((await loadAdminPaddleSales()).find(s=>s.currency==='USD')).toMatchObject({grossMinor:1599,refundedMinor:200,netMinor:1399,paidOrders:2});
 }finally{vi.unstubAllEnvs();}
});
