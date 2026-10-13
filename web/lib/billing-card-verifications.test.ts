import type { Sql } from "postgres";
import { afterEach, expect, it, vi } from "vitest";
import { cleanupExpiredBillingCardVerifications } from "./billing-card-verifications";
import { revokeThePayOneCard } from "./thepayone";

vi.mock("./thepayone", () => ({
  createPaymentTrackId: () => "fixture-track",
  decryptCardToken: () => "fixture-card",
  revokeThePayOneCard: vi.fn(),
  thePayOneCredentialScopeForPackage: () => "default",
  thePayOneCredentialScopeForMerchantTerminal: () => "default",
  ThePayOneError: class extends Error {},
}));
afterEach(() => vi.restoreAllMocks());

it("finishes the current disposal and defers unclaimed cards until the next run", async () => {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const cards = ["first", "second", "third"];
  const claimed: string[] = [];
  const completed: string[] = [];
  const db = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("");
    if (sql.includes("select id")) return cards.filter((id) => !completed.includes(id)).map((id) => ({ id }));
    if (sql.includes("set status='revoking'")) {
      const id = String(values[0]); claimed.push(id);
      return [{ id, planCode: "pro", billingKeyCiphertext: "x", billingKeyIv: "x", billingKeyTag: "x" }];
    }
    completed.push(String(values.at(-1)));
    return [];
  }) as unknown as Sql;
  vi.mocked(revokeThePayOneCard).mockImplementation(async () => {
    now += 31_000;
    return { resultCode: "0000", providerTransactionId: "synthetic" };
  });
  expect(await cleanupExpiredBillingCardVerifications(db)).toEqual({ selected: 3, revoked: 1, failed: 0, deferred: 2 });
  expect(claimed).toEqual(["first"]);
  expect(completed).toEqual(["first"]);
  expect(await cleanupExpiredBillingCardVerifications(db)).toEqual({ selected: 2, revoked: 1, failed: 0, deferred: 1 });
  expect(claimed).toEqual(["first", "second"]);
});
