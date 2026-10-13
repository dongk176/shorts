import type { Sql } from "postgres";
import { afterEach, expect, it, vi } from "vitest";
import { processBillingRenewals } from "./billing-renewals";

const state = vi.hoisted(() => ({ now: 0 }));
vi.mock("./billing-card-verifications", () => ({
  cleanupExpiredBillingCardVerifications: async () => {
    state.now += 91_000;
    return { selected: 3, revoked: 1, failed: 0, deferred: 2 };
  },
}));
vi.mock("./billing-payment-method-remediation", () => ({ legacyCardReconciliationEnabled: async () => true }));
afterEach(() => vi.restoreAllMocks());

it("leaves unstarted remediation/subscription work for the next cron and reports actual counts", async () => {
  state.now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => state.now);
  const db = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("");
    if (sql.includes("select a.*")) return [{ id: "stale" }];
    if (sql.includes("select * from shorts_mvp.user_subscriptions")) return [{ id: "due1" }, { id: "due2" }];
    return [];
  }) as unknown as Sql;
  expect(await processBillingRenewals(db)).toMatchObject({
    staleRemediationAttempts: 0, deferredRemediationAttempts: 1,
    processed: 0, deferred: 2, results: {},
  });
});
