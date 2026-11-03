import fs from "node:fs";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { PGlite } from "../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
vi.mock("server-only", () => ({}));
vi.mock("./api", () => ({ paypalRequest: vi.fn(),paypalEnabled:()=>true,paypalEnvironment:()=>process.env.PAYPAL_ENVIRONMENT }));
import { paypalRequest } from "./api";
import { prepareOneTimeOrder, confirmOneTimeOrder, cancelOneTimeOrder, getOneTimeState, processOneTimeEvent, type PayPalOrder, type PayPalCapture } from "./one-time";
import { oneTimeReturnOrigin } from "./one-time-config";
let pg: PGlite;
const user = "00000000-0000-4000-8000-000000000101", other = "00000000-0000-4000-8000-000000000102";
const orders = new Map<string, PayPalOrder>();
const captures = new Map<string, PayPalCapture>();
const refunds = new Map<string,unknown>();
let number = 0;
function adapter(engine: Pick<PGlite, "query">): Sql {
  const sql = async (s: TemplateStringsArray, ...values: unknown[]) => {
    const result = await engine.query<Record<string, unknown>>(s.reduce((query, part, i) => query + (i ? "$" + i : "") + part, ""), values);
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value])));
  };
  return Object.assign(sql, { begin: (fn: (tx: Sql) => Promise<unknown>) => pg.transaction(tx => fn(adapter(tx))) }) as unknown as Sql;
}
const db = () => adapter(pg);
function completed(id: string) {
  const order = orders.get(id)!;
  const capture: PayPalCapture = { id: "CAPTURE" + id.slice(-10), status: "COMPLETED", final_capture: true,
    amount: order.purchase_units[0].amount, create_time: "2026-01-31T12:00:00Z", supplementary_data: { related_ids: { order_id: id } } };
  captures.set(capture.id, capture);
  order.status = "COMPLETED"; order.purchase_units[0].payments = { captures: [capture] };
  return order;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(fs.readFileSync("../scripts/paypal-one-time-fixture.sql", "utf8"));
  await pg.exec(fs.readFileSync("../supabase/migrations/20261103093627_paypal_one_time_orders.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  vi.stubEnv("PAYPAL_ONE_TIME_ENABLED", "true"); vi.stubEnv("PAYPAL_ENVIRONMENT", "sandbox"); vi.stubEnv("VERCEL", "");
  vi.stubEnv("DATABASE_URL", "postgres://postgres:postgres@127.0.0.1:55441/postgres");
  vi.stubEnv("PAYPAL_RETURN_ORIGIN", "http://127.0.0.1:3160");
  await pg.exec(`truncate shorts_mvp.app_users,shorts_mvp.billing_orders,shorts_mvp.billing_toss_checkout_intents,shorts_mvp.paddle_checkouts,shorts_mvp.paddle_payments,shorts_mvp.paypal_checkouts,shorts_mvp.user_subscriptions,shorts_mvp.usage_grants cascade;
    insert into shorts_mvp.app_users(id)values('${user}'),('${other}')`);
  orders.clear(); captures.clear(); refunds.clear(); number = 0;
  vi.mocked(paypalRequest).mockReset().mockImplementation(async (path, body) => {
    if (path === "/v2/checkout/orders") {
      const input = structuredClone(body) as PayPalOrder;
      const id = "ORDER" + String(++number).padStart(12, "0");
      const order: PayPalOrder = { id, intent: input.intent, status: "PAYER_ACTION_REQUIRED", purchase_units: input.purchase_units.map(unit => ({ ...unit, payee: { merchant_id: "MERCHANT12345" } })), links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
      orders.set(id, order); return structuredClone(order);
    }
    if (path.startsWith("/v2/payments/captures/")) return structuredClone(captures.get(path.split("/").at(-1)!));
    if (path.startsWith("/v2/payments/refunds/")) return structuredClone(refunds.get(path.split("/").at(-1)!));
    const id = path.split("/")[4];
    if (path.endsWith("/capture")) return structuredClone(completed(id));
    const order = orders.get(id); if (!order) throw Error("Unconfirmed reference");
    return structuredClone(order);
  });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => pg.close());
async function ready(code = "pro_1m") {
  const result = await prepareOneTimeOrder(user, code, "en", db());
  const remote = [...orders.values()].at(-1)!;
  return { ...result, remote };
}
it("creates one-time USD checkout with no shipping, guest landing and fixed English locale", async () => {
  await ready();
  const body = vi.mocked(paypalRequest).mock.calls[0][1] as { payment_source: { paypal: { experience_context: Record<string, string> } } };
  expect(body.payment_source.paypal.experience_context).toMatchObject({ landing_page: "GUEST_CHECKOUT", shipping_preference: "NO_SHIPPING", locale: "en-US", user_action: "PAY_NOW" });
  expect((await pg.query("select * from shorts_mvp.usage_grants")).rows).toHaveLength(0);
});
it("never grants on approval alone and captures exactly once", async () => {
  const { checkoutId, remote } = await ready();
  expect((await confirmOneTimeOrder(user, checkoutId, db())).paid).toBe(false);
  remote.status = "APPROVED";
  expect((await confirmOneTimeOrder(user, checkoutId, db())).paid).toBe(true);
  await confirmOneTimeOrder(user, checkoutId, db());
  expect(vi.mocked(paypalRequest).mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(1);
  expect((await pg.query("select * from shorts_mvp.usage_grants")).rows).toHaveLength(1);
  expect((await pg.query("select cancel_at_period_end,next_charge_at from shorts_mvp.user_subscriptions")).rows[0]).toEqual({ cancel_at_period_end: true, next_charge_at: null });
});
it("cancels unpaid checkout and allows a different plan; old approval cannot capture", async () => {
  const first = await ready(); await cancelOneTimeOrder(user, first.checkoutId, db());
  await ready("starter_6m"); first.remote.status = "APPROVED";
  expect((await confirmOneTimeOrder(user, first.checkoutId, db())).status).toBe("canceled");
  expect(vi.mocked(paypalRequest).mock.calls.filter(([path]) => path.endsWith("/capture"))).toHaveLength(0);
});
it("replaces an abandoned ready checkout with a different plan after canonical unpaid verification", async () => {
  const first = await ready(); const second = await ready("starter_3m");
  expect(first.checkoutId).not.toBe(second.checkoutId);
  expect((await getOneTimeState(user, first.checkoutId, db())).status).toBe("canceled");
});
it("blocks another checkout after an ambiguous create, with no second remote creation", async () => {
  vi.mocked(paypalRequest).mockRejectedValueOnce(Error("Timeout"));
  await expect(ready()).rejects.toThrow("Timeout");
  await expect(ready("starter_3m")).rejects.toThrow("needs confirmation");
  expect(paypalRequest).toHaveBeenCalledTimes(1);
});
it("recovers a completed capture after a lost response without a second capture or duplicate credit", async () => {
  const { checkoutId, remote } = await ready(); remote.status = "APPROVED";
  const original = vi.mocked(paypalRequest).getMockImplementation()!;
  vi.mocked(paypalRequest).mockImplementation(async (path, ...rest) => {
    if (path.endsWith("/capture")) { completed(remote.id); throw Error("Lost response"); }
    return original(path, ...rest);
  });
  await expect(confirmOneTimeOrder(user, checkoutId, db())).rejects.toThrow("Lost response");
  expect((await confirmOneTimeOrder(user, checkoutId, db())).paid).toBe(true);
  expect((await pg.query("select * from shorts_mvp.usage_grants")).rows).toHaveLength(1);
});
it("does not grant pending capture or allow another checkout", async () => {
  const { checkoutId, remote } = await ready(); completed(remote.id);
  captures.values().next().value!.status = "PENDING";
  expect((await confirmOneTimeOrder(user, checkoutId, db())).paid).toBe(false);
  expect((await pg.query("select * from shorts_mvp.usage_grants")).rows).toHaveLength(0);
  await expect(ready("starter_3m")).rejects.toThrow();
});
it.each(["merchant", "currency", "amount", "identity", "capture-order"])("rejects a %s mismatch without granting", async mismatch => {
  const { checkoutId, remote } = await ready(); completed(remote.id);
  const unit = remote.purchase_units[0];
  if (mismatch === "merchant") unit.payee.merchant_id = "OTHER1234567";
  if (mismatch === "currency") unit.amount.currency_code = "JPY";
  if (mismatch === "amount") unit.amount.value = "1.00";
  if (mismatch === "identity") unit.custom_id = other;
  if (mismatch === "capture-order") captures.values().next().value!.supplementary_data!.related_ids!.order_id = "OTHER1234567";
  await expect(confirmOneTimeOrder(user, checkoutId, db())).rejects.toThrow("mismatch");
  expect((await pg.query("select * from shorts_mvp.usage_grants")).rows).toHaveLength(0);
});
it("binds the checkout to the authenticated app user", async () => {
  const { checkoutId } = await ready();
  await expect(confirmOneTimeOrder(other, checkoutId, db())).rejects.toThrow("not found");
  await expect(cancelOneTimeOrder(other, checkoutId, db())).rejects.toThrow("not found");
});
it("grants twelve separate monthly windows from the original month-end anchor", async () => {
  const { checkoutId, remote } = await ready("expert_12m"); remote.status = "APPROVED";
  await confirmOneTimeOrder(user, checkoutId, db());
  const rows = (await pg.query<{ valid_from: Date; expires_at: Date; total_seconds: number }>("select * from shorts_mvp.usage_grants order by valid_from")).rows;
  expect(rows).toHaveLength(12); expect(rows.every(row => row.total_seconds === 36000)).toBe(true);
  expect(new Date(rows[0].expires_at).toISOString()).toBe("2026-02-28T12:00:00.000Z");
  expect(new Date(rows[2].valid_from).toISOString()).toBe("2026-03-31T12:00:00.000Z");
  expect(new Date(rows[11].expires_at).toISOString()).toBe("2027-01-31T12:00:00.000Z");
});
it.each(["toss", "thepayone", "nicepay", "paddle"])("blocks a historical successful %s payer", async provider => {
  if (provider === "paddle") await pg.query("insert into shorts_mvp.paddle_payments(user_id)values($1)", [user]);
  else await pg.query("insert into shorts_mvp.billing_orders(user_id,provider,amount_krw,status,approved_at)values($1,$2,9900,'refunded',now())", [user, provider]);
  await expect(ready()).rejects.toThrow("existing payment provider");
  expect(paypalRequest).not.toHaveBeenCalled();
});
it("allows failed Paddle attempts and prevents a simultaneous domestic payment and withdrawal", async () => {
  await pg.query("insert into shorts_mvp.paddle_checkouts(user_id,status)values($1,'failed')", [user]);
  await ready();
  await expect(pg.query("insert into shorts_mvp.billing_orders(user_id)values($1)", [user])).rejects.toThrow("one-time checkout");
  await expect(pg.query("update shorts_mvp.app_users set withdrawn_at=now() where id=$1", [user])).rejects.toThrow("one-time checkout");
});
it.each(["live", "remote-db", "vercel"])("fails closed for a %s configuration", kind => {
  if (kind === "live") vi.stubEnv("PAYPAL_ENVIRONMENT", "live");
  if (kind === "remote-db") vi.stubEnv("DATABASE_URL", "postgres://user:pass@db.example.com/postgres");
  if (kind === "vercel") vi.stubEnv("VERCEL", "1");
  expect(() => oneTimeReturnOrigin()).toThrow(kind === "live" ? "Invalid Live checkout configuration" : "isolated local database");
});

function refunded(remote:PayPalOrder,amount='2.00',id='REFUND00000000001') {
 const capture=remote.purchase_units[0].payments!.captures![0];
 const canonical=captures.get(capture.id)!;
 canonical.status=amount===remote.purchase_units[0].amount.value?'REFUNDED':'PARTIALLY_REFUNDED';
 const refund={id,status:'COMPLETED',amount:{currency_code:'USD',value:amount},links:[{rel:'up',href:`https://api-m.sandbox.paypal.com/v2/payments/captures/${capture.id}`}]};
 refunds.set(id,refund);remote.purchase_units[0].payments!.refunds=[...(remote.purchase_units[0].payments!.refunds||[]),{id}];
 return refund;
}
it('canonical refund history recovers a missing notification and deduplicates refunds',async()=>{
 const {checkoutId,remote}=await ready();remote.status='APPROVED';await confirmOneTimeOrder(user,checkoutId,db());
 refunded(remote);await confirmOneTimeOrder(user,checkoutId,db(),true);await confirmOneTimeOrder(user,checkoutId,db(),true);
 expect((await pg.query<{refunded_minor:number}>('select refunded_minor from shorts_mvp.paypal_one_time_orders')).rows[0].refunded_minor).toBe(200);
 expect((await pg.query<{total_seconds:number}>('select total_seconds from shorts_mvp.usage_grants')).rows[0].total_seconds).toBe(3000);
 expect((await pg.query('select * from shorts_mvp.paypal_one_time_refunds')).rows).toHaveLength(1);
});
it('full refund revokes allowance while preserving already consumed seconds',async()=>{
 const {checkoutId,remote}=await ready();remote.status='APPROVED';await confirmOneTimeOrder(user,checkoutId,db());
 await pg.exec('update shorts_mvp.usage_grants set consumed_seconds=100');
 const refund=refunded(remote,'12.00');await processOneTimeEvent({event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{id:refund.id}},db());
 expect((await getOneTimeState(user,checkoutId,db())).paid).toBe(false);
 const grant=(await pg.query('select total_seconds,status from shorts_mvp.usage_grants')).rows[0];expect(grant).toEqual({total_seconds:100,status:'revoked'});
 expect((await pg.query<{status:string}>('select status from shorts_mvp.user_subscriptions')).rows[0].status).toBe('canceled');
});
it('rejects a refund that belongs to another capture',async()=>{
 const {checkoutId,remote}=await ready();remote.status='APPROVED';await confirmOneTimeOrder(user,checkoutId,db());
 const refund=refunded(remote);refund.links[0].href='https://api-m.sandbox.paypal.com/v2/payments/captures/OTHER1234567';
 await expect(confirmOneTimeOrder(user,checkoutId,db(),true)).rejects.toThrow('Refund mismatch');
 expect((await pg.query<{refunded_minor:number}>('select refunded_minor from shorts_mvp.paypal_one_time_orders')).rows[0].refunded_minor).toBe(0);
});
it('a reversal stays revoked after later completed notifications',async()=>{
 const {checkoutId,remote}=await ready();remote.status='APPROVED';await confirmOneTimeOrder(user,checkoutId,db());
 const capture=remote.purchase_units[0].payments!.captures![0];
 await processOneTimeEvent({event_type:'PAYMENT.CAPTURE.REVERSED',resource:{id:capture.id}},db());
 await processOneTimeEvent({event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:capture.id}},db());
 expect((await getOneTimeState(user,checkoutId,db())).status).toBe('reversed');
 expect((await pg.query<{status:string}>('select status from shorts_mvp.usage_grants')).rows[0].status).toBe('revoked');
});
it('allows manual repurchase after expiry without violating the production unique index',async()=>{
 const first=await ready();first.remote.status='APPROVED';await confirmOneTimeOrder(user,first.checkoutId,db());
 const second=await ready('starter_3m');second.remote.status='APPROVED';await confirmOneTimeOrder(user,second.checkoutId,db());
 expect((await pg.query('select * from shorts_mvp.user_subscriptions')).rows).toHaveLength(2);
 expect((await pg.query<{n:number}>("select count(*)::int as n from shorts_mvp.user_subscriptions where status='expired'")).rows[0].n).toBe(1);
});
it('an unknown previous recurring reference blocks new checkout without creating an order',async()=>{
 await pg.query("insert into shorts_mvp.paypal_checkouts(user_id,environment,status,provider_subscription_id)values($1,'sandbox','ready','I-OLD12345678')",[user]);
 await expect(ready()).rejects.toThrow('Unconfirmed reference');expect(orders.size).toBe(0);
});
it('completed order approval event grants once even without a browser return',async()=>{
 const {checkoutId,remote}=await ready();remote.status='APPROVED';
 await processOneTimeEvent({event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:remote.id}},db());
 await processOneTimeEvent({event_type:'CHECKOUT.ORDER.APPROVED',resource:{id:remote.id}},db());
 expect((await getOneTimeState(user,checkoutId,db())).paid).toBe(true);
 expect((await pg.query('select * from shorts_mvp.usage_grants')).rows).toHaveLength(1);
});
it('a declined canonical capture permits a different purchase without granting access',async()=>{
 const {checkoutId,remote}=await ready();completed(remote.id);captures.values().next().value!.status='DECLINED';
 expect((await confirmOneTimeOrder(user,checkoutId,db())).status).toBe('declined');
 await ready('starter_3m');expect((await pg.query('select * from shorts_mvp.usage_grants')).rows).toHaveLength(0);
});
