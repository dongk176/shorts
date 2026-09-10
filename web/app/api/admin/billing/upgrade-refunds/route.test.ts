import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ db: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/admin", () => ({ requireAdminUser: mocks.admin }));
import { PATCH } from "./route";
const id = "11111111-1111-4111-8111-111111111111";
function request(reference?: string) { return new Request("http://localhost/api/admin/billing/upgrade-refunds", { method: "PATCH", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ id, action: "completed", providerReference: reference }) }); }
function db(status: string) {
  const query = vi.fn(async (parts: TemplateStringsArray) => {
    if (parts.join("").includes("select *")) return [{ id, status, sourceOrderId: "old-payment", refundAmountKrw: 9900 }];
    return [{ id, status: "completed" }];
  });
  mocks.db.mockReturnValue(Object.assign(query, { begin: (run: (tx: typeof query) => Promise<unknown>) => run(query), json: (value: unknown) => value }));
  return query;
}
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ id: "admin" }); });
describe("manual completion of ThePayOne upgrade refunds", () => {
  it("requires evidence of the external refund before recording completion", async () => {
    const query = db("manual_review");
    expect((await PATCH(request())).status).toBe(400);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("updates only the old payment and audit record, retaining the new entitlement", async () => {
    const query = db("manual_review");
    expect((await PATCH(request("transfer-confirmation"))).status).toBe(200);
    const calls = query.mock.calls as unknown as Array<[TemplateStringsArray, ...unknown[]]>;
    expect(calls.some(([parts, ...values]) => parts.join("").includes("update shorts_mvp.billing_orders") && values.includes("old-payment") && values.includes(9900))).toBe(true);
    expect(calls.some(([parts]) => /usage_grants|user_subscriptions/.test(parts.join("")))).toBe(false);
    expect(calls.some(([parts]) => parts.join("").includes("admin_audit_logs"))).toBe(true);
  });
  it("does not add the refund again when completion is replayed", async () => {
    const query = db("completed");
    expect((await PATCH(request("transfer-confirmation"))).status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
