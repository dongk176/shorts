import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), admin: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/admin", () => ({ requireAdminUser: mocks.admin }));
vi.mock("@/lib/language-test", async (original) => ({ ...await original<object>(), languageTestStatus: mocks.status }));
import { PATCH } from "./route";
import { HttpError } from "@/lib/http";
const adminId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
const request = (body: unknown) => new Request("https://www.easycut.co.kr/api/admin/language-test", {
  method: "PATCH", headers: { "Content-Type": "application/json", Origin: "https://www.easycut.co.kr" }, body: JSON.stringify(body),
});
const queries: { query: string; values: unknown[] }[] = [];
beforeEach(() => {
  vi.clearAllMocks(); queries.length = 0;
  mocks.admin.mockResolvedValue({ id: adminId });
  mocks.status.mockResolvedValue({ enabled: true, publicEnabled: false, ready: true, releaseId: adminId });
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push({ query: strings.join("?"), values }); return Promise.resolve([]);
  });
  mocks.db.mockReturnValue({ begin: (fn: (tx: unknown) => unknown) => fn(sql) });
});
describe("admin public language switch", () => {
  it("publishes all users and audits actor, runtime state, release and public state", async () => {
    const response = await PATCH(request({ publicEnabled: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, publicEnabled: true });
    expect(queries.find((q) => q.query.includes("update shorts_mvp.language_test_settings"))?.values).toEqual([true, 100]);
    expect(queries.find((q) => q.query.includes("insert into"))?.values).toEqual([adminId, true, 100, adminId]);
  });
  it("keeps admins enabled when public is turned OFF", async () => {
    mocks.status.mockResolvedValue({ enabled: true, publicEnabled: true, ready: true, releaseId: adminId });
    const response = await PATCH(request({ publicEnabled: false }));
    expect(await response.json()).toMatchObject({ enabled: true, publicEnabled: false });
  });
  it.each([false, true])("OFF is always possible with readiness=%s", async (ready) => {
    mocks.status.mockResolvedValue({ enabled: false, publicEnabled: true, ready, releaseId: null });
    expect((await PATCH(request({ publicEnabled: false }))).status).toBe(200);
  });
  it.each([{ enabled: false, ready: true }, { enabled: true, ready: false }])("rejects unready ON without a write: %s", async (state) => {
    mocks.status.mockResolvedValue({ ...state, publicEnabled: false, releaseId: null });
    expect((await PATCH(request({ publicEnabled: true }))).status).toBe(503);
    expect(queries.some((q) => /^(update|insert)/.test(q.query.trim()))).toBe(false);
  });
  it("retains the old enabled request format", async () => {
    expect((await PATCH(request({ enabled: false }))).status).toBe(200);
  });
  it("rejects a non-admin and an unsupported percentage before any write", async () => {
    expect((await PATCH(request({ public_rollout_percent: 20 }))).status).toBe(400);
    mocks.admin.mockRejectedValue(new HttpError(403, "접근 권한이 없습니다."));
    expect((await PATCH(request({ publicEnabled: true }))).status).toBe(403);
    expect(queries).toEqual([]);
  });
});
