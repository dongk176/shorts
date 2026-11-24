import type { Sql } from "postgres";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { processTossBillingRenewals } from "./toss-billing-renewals";

const mocks = vi.hoisted(() => ({
  charge: vi.fn(), reconcile: vi.fn(), sync: vi.fn(), clock: 0,
}));
vi.mock("./toss-billing-config", () => ({ tossBillingSecretKey: () => "test-only" }));
vi.mock("./toss-billing-runtime", () => ({ tossRuntimeRenewalsEnabled: async () => true }));
vi.mock("./billing-cohort", () => ({ assertPersistedTossBillingCustomer: async () => ({}) }));
vi.mock("./toss-billing-ledger", () => ({
  executeRecordedTossCharge: mocks.charge, reconcileUnknownTossPayment: mocks.reconcile,
}));
vi.mock("./toss-billing-service", () => ({ loadTossChargeCredentials: async () => ({}) }));
vi.mock("./billing", async (importOriginal) => ({
  ...await importOriginal<object>(), syncCachedPlan: mocks.sync,
}));
const now = new Date("2026-11-24T00:00:00Z");
function scenario(options: {
  payment: "failed" | "unknown" | "succeeded";
  fresh?: boolean; failGrant?: boolean; closed?: boolean; ids?: string[];
}) {
  const subscription = {
    id: "sub1", userId: "user1", planCode: "toss_easycut_pro_1m", status: options.closed ? "canceled" : "active",
    paymentMethodId: "method1", currentPeriodStart: new Date("2026-10-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-11-01T00:00:00Z"), nextQuotaAt: new Date("2026-11-01T00:00:00Z"),
    retryCount: 0, nextRetryAt: null, graceEndsAt: null, cancelAtPeriodEnd: false, billingAnchorDay: 1,
  };
  const order = { id: "order1", orderId: "EC-REN-test", productCode: subscription.planCode,
    amountKrw: 9900, paymentMethodId: "method1", status: options.fresh ? "pending" : options.payment,
    renewalPeriodStart: subscription.currentPeriodEnd };
  const ledger = { id: "tx1", status: options.fresh ? "pending" : options.payment,
    fulfillmentStatus: "pending", attemptNo: 1, nextRetryAt: null };
  const writes: string[] = [];
  let grants = 0;
  const sql = async (parts: TemplateStringsArray) => {
    const q = parts.join("?").replace(/\s+/g, " ").trim();
    if (q.startsWith("update shorts_mvp.billing_toss_transactions transaction")) {
      if (options.closed && ledger.status === "succeeded" && ledger.fulfillmentStatus === "pending") {
        ledger.fulfillmentStatus = "manual_review"; return [{ id: "tx1" }];
      }
      return [];
    }
    if ((q.startsWith("select subscription.id") || q.startsWith("select distinct subscription.id"))) return options.closed ? [] : (options.ids ?? ["sub1"]).map(id => ({ id }));
    if (q.startsWith("select transaction.id")) return ledger.status === "unknown" ? [{ id: "tx1" }] : [];
    if (q.startsWith("select id from shorts_mvp.billing_toss_transactions")) return ledger.status === "unknown" ? [{ id: "tx1" }] : [];
    if (q.startsWith("select transaction.provider_order_id")) return [{ providerOrderId: "EC-REN-test" }];
    if (q.startsWith("select status,failure_code")) return [ledger];
    if (q.startsWith("select id,user_id,plan_code")) return [subscription];
    if (q.startsWith("select pg_advisory")) return [];
    if (q.startsWith("select coalesce(sum(reserved_seconds)")) return [{ reservedSeconds: 0 }];
    if (q.startsWith("select id,user_id,subscription_id")) return [order];
    if (q.startsWith("select attempt_no")) return options.fresh ? [] : [ledger];
    if (q.startsWith("select id,product_code,status")) return [order];
    if (q.startsWith("select id,fulfillment_status")) return [ledger];
    if (q.startsWith("insert into shorts_mvp.usage_grants")) {
      if (options.failGrant) throw new Error("simulated database failure after approval");
      grants++; return [];
    }
    if (q.startsWith("update")) {
      writes.push(q);
      if (q.includes("set status='past_due',retry_count=")) subscription.status = "past_due";
      if (q.includes("set fulfillment_status='applied'")) ledger.fulfillmentStatus = "applied";
      return [];
    }
    throw new Error(`Unexpected test SQL: ${q}`);
  };
  const db = Object.assign(sql, { begin: async (fn: (tx: unknown) => unknown) => fn(db) }) as unknown as Sql;
  mocks.charge.mockImplementation(async () => {
    ledger.status = options.payment; order.status = options.payment;
    return { state: options.payment };
  });
  return { db, ledger, subscription, writes, grants: () => grants };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => mocks.clock);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("restores a committed decline after interruption, without charging again", async () => {
  const s = scenario({ payment: "failed" });
  const result = await processTossBillingRenewals(s.db, { now });
  expect(result.results[0].state).toBe("wait");
  expect(s.subscription.status).toBe("past_due");
  expect(mocks.charge).not.toHaveBeenCalled();
});
it("keeps an uncertain charge blocked and restores its subscription state", async () => {
  const s = scenario({ payment: "unknown" });
  expect((await processTossBillingRenewals(s.db, { now })).reconciliationPending).toBe(1);
  expect(s.subscription.status).toBe("past_due");
  expect(mocks.charge).not.toHaveBeenCalled();
  expect(s.grants()).toBe(0);
});
it("replays an approved pending fulfillment without another provider call", async () => {
  const s = scenario({ payment: "succeeded" });
  expect((await processTossBillingRenewals(s.db, { now })).renewed).toBe(1);
  expect(s.ledger.fulfillmentStatus).toBe("applied");
  expect(s.grants()).toBe(1);
  expect(mocks.charge).not.toHaveBeenCalled();
  await processTossBillingRenewals(s.db, { now });
  expect(s.grants()).toBe(1);
});
it("does not turn an approved payment into a declined subscription when grant persistence fails", async () => {
  const s = scenario({ payment: "succeeded", fresh: true, failGrant: true });
  await processTossBillingRenewals(s.db, { now });
  expect(mocks.charge).toHaveBeenCalledOnce();
  expect(s.ledger.status).toBe("succeeded");
  expect(s.ledger.fulfillmentStatus).toBe("pending");
  expect(s.subscription.status).toBe("active");
  expect(s.writes.some(q => q.includes("set status='past_due',retry_count="))).toBe(false);
});
it("flags an orphaned approved payment without reviving, charging or granting the canceled subscription", async () => {
  const s = scenario({ payment: "succeeded", closed: true });
  expect((await processTossBillingRenewals(s.db, { now })).closedFulfillmentsForReview).toBe(1);
  expect(s.subscription.status).toBe("canceled");
  expect(s.ledger.status).toBe("succeeded");
  expect(s.ledger.fulfillmentStatus).toBe("manual_review");
  expect(s.grants()).toBe(0);
  expect(mocks.charge).not.toHaveBeenCalled();
});
it("defers a new item when the remaining invocation budget cannot contain a full charge", async () => {
  const s = scenario({ payment: "succeeded", ids: ["sub1", "sub2"] });
  expect(await processTossBillingRenewals(s.db, { now, deadlineMs: 89_000 })).toMatchObject({ processed: 0, deferred: 2 });
  expect(mocks.charge).not.toHaveBeenCalled();
});
