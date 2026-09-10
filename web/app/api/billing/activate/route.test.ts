import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn(), plan: vi.fn(), charge: vi.fn(), refund: vi.fn(), pause: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/billing", async (original) => ({
  ...(await original<typeof import("@/lib/billing")>()),
  getPaidPlan: mocks.plan,
  assertPricingV2PackagePurchaseAvailable: vi.fn(),
}));
vi.mock("@/lib/manual-payment-routing", () => ({ oneTimePaymentMode: () => "manual", assertManualPaymentAvailable: vi.fn() }));
vi.mock("@/lib/installments", async (original) => ({
  ...(await original<typeof import("@/lib/installments")>()),
  validateInstallmentSelection: vi.fn(async () => ({ campaignId: null, snapshot: {} })),
}));
vi.mock("@/lib/thepayone", async (original) => ({
  ...(await original<typeof import("@/lib/thepayone")>()),
  assertThePayOneBillingEnabled: vi.fn(),
  thePayOneMerchantId: () => "merchant",
  thePayOneTerminalId: (scope = "default") => scope === "manual" ? "arti02" : "arti01",
  decryptCardToken: () => "old-card",
  chargeThePayOneManualCard: mocks.charge,
  refundThePayOnePayment: mocks.refund,
  changeThePayOneCardStatus: mocks.pause,
}));

import { readFileSync } from "node:fs";
import postgres from "postgres";
import { POST } from "./route";
import { ThePayOneError } from "@/lib/thepayone";

const userId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const approvedAt = new Date("2026-09-10T00:00:00Z");
type Query = { text: string; values: unknown[] };
function fixture(options: { reviewed?: boolean; reservedRefund?: boolean; failGrant?: boolean; concurrentRefund?: boolean } = {}) {
  const queries: Query[] = [];
  let committed = false;
  const subscription = { id: "subscription", userId, planCode: "easycut_pro_v2", status: "active", billingCycle: "monthly", paymentMethodId: "old-method", currentPeriodStart: new Date("2026-09-01T00:00:00Z"), currentPeriodEnd: new Date("2026-10-01T00:00:00Z"), nextQuotaAt: new Date("2026-10-01T00:00:00Z"), billingAnchorDay: 1 };
  const source = { id: "old-order", amountKrw: 9900, refundedAmountKrw: 0, refundStatus: options.reviewed ? "manual_review" : "none", prorationRefundStatus: options.reviewed ? "manual_review" : "none", hasReservedRefund: options.reservedRefund ?? false, providerTransactionId: "old-payment", providerMerchantId: "merchant", providerTerminalId: "arti01", approvedAt: new Date("2026-09-01T00:00:00Z"), providerAuthCode: "test-auth", providerTransactionDay: "2026-09-01" };
  const order = { id: "upgrade-order", orderId: "EC-TEST-UPGRADE", productCode: "starter_12m", billingCycle: "yearly", amountKrw: 198000, prorationCreditKrw: 9900, status: "pending", checkoutExpiresAt: new Date("2026-09-10T00:10:00Z"), installmentMonths: 6 };
  const query = vi.fn(async (parts: TemplateStringsArray | unknown[], ...values: unknown[]): Promise<unknown[]> => {
    if (!("raw" in parts)) return parts;
    const text = parts.reduce((all, part, i) => `${all}${part}${i < values.length ? `$${i + 1}` : ""}`, "").replace(/\s+/g, " ").trim();
    queries.push({ text, values });
    if (text.startsWith("select id,order_id,product_code")) return committed ? [{ ...order, status: "succeeded" }] : [];
    if (text.startsWith("select * from shorts_mvp.user_subscriptions")) return [subscription];
    if (text.startsWith("select o.*")) return [source];
    if (text.startsWith("select * from shorts_mvp.billing_payment_methods")) return [{ id: "old-method", provider: "thepayone", status: "active", providerScheduleStatus: "active", issuerName: "Test", cardLast4: "4242" }];
    if (text.startsWith("insert into shorts_mvp.billing_orders")) return [order];
    if (text.includes("set status='processing'") && text.includes("returning id")) return [{ id: order.id }];
    if (text.startsWith("insert into shorts_mvp.billing_attempts")) return [{ id: "attempt" }];
    if (text.includes("proration_refund_status='pending'") && text.includes("returning id")) return [{ id: source.id }];
    if (text.startsWith("select id,total_seconds")) return [{ id: "old-grant", totalSeconds: 3600, consumedSeconds: 600, reservedSeconds: 60 }];
    if (text.startsWith("select id from shorts_mvp.usage_grants")) return [{ id: "new-grant" }];
    if (text.startsWith("select id from shorts_mvp.subscription_upgrade_refunds")) return options.concurrentRefund ? [{ id: "another-refund" }] : [];
    if (text.startsWith("insert into shorts_mvp.usage_grants") && options.failGrant) throw new Error("quota storage unavailable");
    if (text.includes("set subscription_id=") && text.includes("status='succeeded'")) committed = true;
    return [];
  });
  const db = Object.assign(query, { json: (value: unknown) => value, begin: async (run: (tx: typeof query) => Promise<void>) => {
    const previous = committed;
    try { await run(query); } catch (error) { committed = previous; throw error; }
  } });
  mocks.db.mockReturnValue(db);
  return { queries, committed: () => committed };
}
function request(planCode = "starter_12m") {
  return new Request("http://localhost/api/billing/activate", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ mode: "change_subscription", requestId, planCode, billingCycle: "yearly", payerName: "Test", payerEmail: "test@example.com", payerTel: "01012345678", cardNumber: "4242424242424242", expiryYear: "29", expiryMonth: "07", identityNumber: "800101", cardPassword: "12", consent: true, declaredCardKind: "credit", installmentMonths: 6 }),
  });
}
function expectGranted(queries: Query[]) {
  const grant = queries.filter((q) => q.text.startsWith("insert into shorts_mvp.usage_grants"));
  expect(grant).toHaveLength(1);
  expect(grant[0].values.slice(0, 7)).toEqual([userId, "subscription", "upgrade-order", "starter_12m", 12000, 12000, 0]);
  expect(grant[0].values[7]).toEqual(approvedAt);
  expect(grant[0].values[8]).toEqual(new Date("2027-09-10T00:00:00Z"));
  expect(queries.some((q) => q.text.includes("set reserved_seconds=") && q.values[0] === 60)).toBe(true);
  const subscription = queries.find((q) => q.text.includes("set plan_code="));
  expect(subscription?.values[0]).toBe("starter_12m");
  expect(subscription?.text).toContain("status='active'");
  expect(subscription?.values).toContain(null); // package has no next charge
  expect(queries.find((q) => q.text.includes("set next_quota_at="))?.values[0]).toEqual(new Date("2026-10-10T00:00:00Z"));
  expect(mocks.pause).toHaveBeenCalledWith("old-card", "중지", expect.any(String));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(approvedAt);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.session.mockResolvedValue({ userId, user: { email: "test@example.com" } });
  mocks.plan.mockImplementation(async (_db, code) => ({ code, displayName: code, monthlyPriceKrw: 9900, yearlyPriceKrw: code === "starter_12m" ? 198000 : 99000, prepaidMonths: code === "starter_12m" ? 12 : 1, monthlySourceSeconds: code === "starter_12m" ? 12000 : 3600 }));
  mocks.charge.mockResolvedValue({ providerTransactionId: "new-payment", trackId: "EC-TEST-UPGRADE", amount: 198000, cardId: "manual-card", terminalId: "arti02", installmentMonths: 6, cardType: "신용", approvedAt, authCode: "new-auth" });
  mocks.refund.mockImplementation(async (input) => ({ providerTransactionId: "refund-payment", trackId: input.trackId, rootTransactionId: input.rootTransactionId, amount: input.amount, terminalId: "arti01" }));
  mocks.pause.mockResolvedValue({});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("ThePayOne paid upgrade with deferred old-payment refund", () => {
  it.each([
    ["PG rejection", () => new ThePayOneError("환불 가능 잔액 부족", "REFUND_BALANCE_LOW", null, false)],
    ["timeout with unknown outcome", () => new ThePayOneError("환불 결과 미확인", "NETWORK_ERROR", null, true)],
  ])("activates and grants usage after %s without refunding the new charge", async (_name, failure) => {
    const state = fixture();
    mocks.refund.mockRejectedValue(failure());
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, planCode: "starter_12m", manualReview: false, refund: { mode: "manual_full", amountKrw: 9900, status: "manual_review" } });
    expect(state.committed()).toBe(true);
    expectGranted(state.queries);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund.mock.calls[0][0]).toMatchObject({ rootTransactionId: "old-payment", amount: 9900 });
    const ledger = state.queries.filter((q) => q.text.startsWith("insert into shorts_mvp.subscription_upgrade_refunds"));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].values).toContain("manual_review");
    expect(ledger[0].values.join(" ")).toContain(failure().resultCode);
  });
  it("defers a mismatched refund success response while still granting the approved upgrade", async () => {
    const state = fixture();
    mocks.refund.mockImplementation(async (input) => ({ providerTransactionId: "refund", trackId: input.trackId, rootTransactionId: "wrong-root", amount: 9900, terminalId: "arti01" }));
    expect((await POST(request())).status).toBe(200);
    expectGranted(state.queries);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(state.queries.find((q) => q.text.startsWith("insert into shorts_mvp.subscription_upgrade_refunds"))?.values.join(" ")).toContain("CURRENT_PAYMENT_REFUND_MISMATCH");
  });
  it("upgrades a previously reviewed refund without automatically retrying it", async () => {
    const state = fixture({ reviewed: true });
    expect((await POST(request())).status).toBe(200);
    expectGranted(state.queries);
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(state.queries.filter((q) => q.text.startsWith("insert into shorts_mvp.subscription_upgrade_refunds"))).toHaveLength(1);
  });
  it("keeps successful automatic refunds and grants exactly once on request replay", async () => {
    const state = fixture();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ refund: { mode: "automatic_full", status: "completed" } });
    const replay = await POST(request());
    expect(await replay.json()).toMatchObject({ ok: true, alreadyProcessed: true });
    expectGranted(state.queries);
    expect(mocks.charge).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(state.queries.filter((q) => q.text.startsWith("insert into shorts_mvp.subscription_upgrade_refunds"))).toHaveLength(0);
    expect((await POST(request("expert_12m"))).status).toBe(409);
  });
  it("does not charge or grant when an old refund obligation is already reserved", async () => {
    const state = fixture({ reservedRefund: true });
    expect((await POST(request())).status).toBe(409);
    expect(mocks.charge).not.toHaveBeenCalled();
    expect(state.committed()).toBe(false);
  });
  it("does not grant usage when the new payment is rejected", async () => {
    const state = fixture();
    mocks.charge.mockRejectedValue(new ThePayOneError("승인실패", "2070"));
    expect((await POST(request())).status).toBe(400);
    expect(state.queries.some((q) => q.text.startsWith("insert into shorts_mvp.usage_grants"))).toBe(false);
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("keeps a mismatched new payment under review without issuing usage", async () => {
    const state = fixture();
    mocks.charge.mockResolvedValue({ providerTransactionId: "new-payment", trackId: "EC-TEST-UPGRADE", amount: 198001, terminalId: "arti02", installmentMonths: 6, cardType: "신용", approvedAt });
    expect((await POST(request())).status).toBe(202);
    expect(state.committed()).toBe(false);
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("does not report success when the grant transaction fails and does not reverse the new charge", async () => {
    const state = fixture({ failGrant: true });
    mocks.refund.mockRejectedValue(new ThePayOneError("환불 불가", "REFUND_BALANCE_LOW"));
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: false, manualReview: true });
    expect(state.committed()).toBe(false);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });
  it("does not duplicate a refund obligation reserved by a concurrent upgrade", async () => {
    const state = fixture({ reviewed: true, concurrentRefund: true });
    expect((await POST(request())).status).toBe(202);
    expect(state.committed()).toBe(false);
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});


it.skipIf(!process.env.THEPAYONE_TEST_DATABASE_URL)("commits upgrade, quota, reservations and deferred refund together in local PostgreSQL", async () => {
  const databaseUrl = new URL(process.env.THEPAYONE_TEST_DATABASE_URL!);
  if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "55439") throw new Error("Synthetic local DB required");
  const sql = postgres(databaseUrl.toString(), { max: 1, prepare: false, transform: postgres.camel });
  try {
    await sql.unsafe(readFileSync(new URL("../../../../test/thepayone-upgrade-fixture.sql", import.meta.url), "utf8"));
    await sql`insert into shorts_mvp.app_users values (${userId},'easycut_pro_v2')`;
    await sql`insert into shorts_mvp.user_subscriptions (id,user_id,plan_code,status,billing_cycle,payment_method_id,payment_provider,provider_schedule_status,current_period_start,current_period_end,billing_anchor_day) values ('subscription',${userId},'easycut_pro_v2','active','monthly','old-method','thepayone','active','2026-09-01','2026-10-01',1)`;
    await sql`insert into shorts_mvp.billing_payment_methods (id,user_id,provider,status,provider_schedule_status) values ('old-method',${userId},'thepayone','active','active')`;
    await sql`insert into shorts_mvp.billing_orders (id,user_id,subscription_id,kind,product_code,billing_cycle,amount_krw,provider,provider_transaction_id,provider_merchant_id,provider_terminal_id,approved_at,status,provider_auth_code) values ('old-order',${userId},'subscription','subscription_initial','easycut_pro_v2','monthly',9900,'thepayone','old-payment','merchant','arti01','2026-09-01','succeeded','test-auth')`;
    await sql`insert into shorts_mvp.usage_grants (id,user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,consumed_seconds,reserved_seconds,valid_from,expires_at) values ('old-grant',${userId},'subscription','old-order','base','easycut_pro_v2',3600,3600,0,600,60,'2026-09-01','2026-10-01')`;
    await sql`insert into shorts_mvp.usage_grant_allocations values ('reservation','old-grant',60,'reserved')`;
    mocks.db.mockReturnValue(sql);
    mocks.charge.mockImplementation(async (input) => ({ providerTransactionId: "new-payment", trackId: input.trackId, amount: input.amount, cardId: "manual-card", terminalId: "arti02", installmentMonths: 6, cardType: "신용", approvedAt, authCode: "new-auth" }));
    mocks.refund.mockRejectedValue(new ThePayOneError("환불 가능 잔액 부족", "REFUND_BALANCE_LOW"));
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ ok: true, planCode: "starter_12m", refund: { mode: "manual_full" } });
    expect(response.status).toBe(200);
    const [subscription] = await sql`select * from shorts_mvp.user_subscriptions`;
    expect(subscription).toMatchObject({ planCode: "starter_12m", status: "active", nextChargeAt: null, nextQuotaAt: new Date("2026-10-10T00:00:00Z") });
    const grants = await sql`select * from shorts_mvp.usage_grants where status='active'`;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ totalSeconds: 12000, creditedSeconds: 12000, reservedSeconds: 60, consumedSeconds: 0, carriedSeconds: 0 });
    const [ledger] = await sql`select * from shorts_mvp.subscription_upgrade_refunds`;
    expect(ledger).toMatchObject({ sourceOrderId: "old-order", refundAmountKrw: 9900, status: "manual_review" });
    expect(ledger.adminNote).toContain("REFUND_BALANCE_LOW");
    const [allocation] = await sql`select * from shorts_mvp.usage_grant_allocations`;
    expect(allocation).toMatchObject({ grantId: grants[0].id, allocatedSeconds: 60, status: "reserved" });
    const [method] = await sql`select * from shorts_mvp.billing_payment_methods`;
    expect(method).toMatchObject({ status: "replaced", providerScheduleStatus: "paused" });
    const [newOrder] = await sql`select * from shorts_mvp.billing_orders where id=${ledger.upgradeOrderId}`;
    expect(newOrder).toMatchObject({ status: "succeeded", refundedAmountKrw: 0, refundStatus: "none" });
    expect(await (await POST(request())).json()).toMatchObject({ alreadyProcessed: true });
    expect((await sql`select id from shorts_mvp.subscription_upgrade_refunds`)).toHaveLength(1);
    expect(mocks.charge).toHaveBeenCalledTimes(1);
  } finally { await sql.end({ timeout: 2 }); }
});
