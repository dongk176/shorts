import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), session: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/language-test", async (original) => ({ ...await original<object>(), languageTestStatus: mocks.status }));
import { GET, POST } from "./route";
const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";
const appUserId = "a4404015-a66b-4efa-9cd3-14eddf4ad3ef";
const request = (body: unknown) => new Request("https://www.easycut.co.kr/api/language-guide", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://www.easycut.co.kr" }, body: JSON.stringify(body),
});
let stored: string | null = null;
let isAdmin = false;
const writes: unknown[][] = [];
beforeEach(() => {
  vi.clearAllMocks(); stored = null; isAdmin = false; writes.length = 0;
  mocks.session.mockResolvedValue({ userId: appUserId, user: { id: userId }, isAdmin: false });
  mocks.status.mockResolvedValue({ enabled: true, publicEnabled: true, ready: true });
  const sql = Object.assign(vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = strings.join("?");
    if (q.includes("app_users")) return [{ isAdmin }];
    if (q.includes("insert into")) { writes.push(values); stored = values[1] as string; return []; }
    if (q.includes("select status")) return stored ? [{ status: stored }] : [];
    return [];
  }), { begin: async (fn: (tx: unknown) => unknown) => fn(sql) });
  mocks.db.mockReturnValue(sql);
});
describe("account language tutorial", () => {
  it.each(["dismissed", "completed"])("persists %s and reads it on another request/device", async (status) => {
    expect(await (await GET()).json()).toEqual({ available: true, seen: false, status: null });
    expect(await (await POST(request({ userId, status }))).json()).toEqual({ saved: true });
    expect(await (await GET()).json()).toEqual({ available: true, seen: true, status });
    expect(writes).toEqual([[appUserId, status]]);
  });
  it("does not consume an ordinary user's tutorial while public is OFF", async () => {
    mocks.status.mockResolvedValue({ enabled: true, publicEnabled: false, ready: true });
    expect(await (await GET()).json()).toEqual({ available: false, seen: false });
    expect(await (await POST(request({ userId, status: "dismissed" }))).json()).toEqual({ saved: false });
    expect(writes).toEqual([]);
  });
  it("lets admins complete the same tutorial while public is OFF", async () => {
    isAdmin = true;
    mocks.session.mockResolvedValue({ userId: appUserId, user: { id: userId }, isAdmin });
    mocks.status.mockResolvedValue({ enabled: true, publicEnabled: false, ready: true });
    expect((await POST(request({ userId, status: "completed" }))).status).toBe(200);
    expect(writes).toHaveLength(1);
  });
  it("rejects a save from a tab whose signed-in account changed", async () => {
    const response = await POST(request({ userId: "8f856acc-5b6a-4f62-9971-d7feb1f2a624", status: "completed" }));
    expect(response.status).toBe(409); expect(writes).toEqual([]);
  });
});
