import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), db: vi.fn(), enterprise: vi.fn(), billing: vi.fn(), paid: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("./db", () => ({ getDb: () => mocks.db, ensureReadDbReady: vi.fn() }));
vi.mock("./enterprise-access", () => ({ assertEnterpriseSessionServiceAccess: mocks.enterprise }));
vi.mock("./billing", () => ({ getBillingSummary: mocks.billing }));
vi.mock("./project-action-entitlements", () => ({ assertPaidProjectActionAccess: mocks.paid }));
import { midformAccess } from "./midform-access";
import { midformRequestSchema, midformDraftSchema } from "./midform-cloud";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MIDFORM_ENABLED", "true"); vi.stubEnv("EASYCUT_ENVIRONMENT", "production");
  vi.stubEnv("MIDFORM_RELEASE_ID", "11111111-1111-4111-8111-111111111111");
  mocks.session.mockResolvedValue({ userId: "admin", isAdmin: true });
  mocks.db.mockResolvedValue([{ id: "admin", isAdmin: true }]);
});
describe("private midform access", () => {
  it("rejects ordinary accounts before any media query", async () => {
    mocks.session.mockResolvedValue({ userId: "user", isAdmin: false });
    await expect(midformAccess(new Request("https://www.easycut.co.kr/api/midform"))).rejects.toMatchObject({ status: 404 });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("rechecks a revoked administrator in the authoritative DB", async () => {
    mocks.db.mockResolvedValue([{ id: "admin", isAdmin: false }]);
    await expect(midformAccess(new Request("https://www.easycut.co.kr/api/midform"))).rejects.toMatchObject({ status: 404 });
    expect(mocks.billing).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before authentication", async () => {
    await expect(midformAccess(new Request("https://www.easycut.co.kr/api/midform", { method: "POST", headers: { origin: "https://other.test" } }))).rejects.toMatchObject({ status: 403 });
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("fails closed when release admission is off", async () => {
    vi.stubEnv("MIDFORM_ENABLED", "false");
    await expect(midformAccess(new Request("https://www.easycut.co.kr/api/midform"))).rejects.toMatchObject({ status: 404 });
  });
  it("allows authenticated, current administrators through the existing entitlement checks", async () => {
    await expect(midformAccess(new Request("https://www.easycut.co.kr/api/midform"))).resolves.toMatchObject({ session: { userId: "admin" } });
    expect(mocks.enterprise).toHaveBeenCalled(); expect(mocks.paid).toHaveBeenCalled();
  });
  it("rejects duration targets and client-selected silence strength", () => {
    expect(midformRequestSchema.safeParse({ version: 1, targetSeconds: 120 }).success).toBe(false);
    const draft = { rows: [{ id: "0", start: 0, end: 2, text: "안녕", speaker: "a", keep: true }], framing: {}, names: {}, removeSilence: true, silencePreset: "aggressive" };
    expect(midformDraftSchema.safeParse(draft).success).toBe(true);
    expect(midformDraftSchema.safeParse({ ...draft, removeSilence: false }).success).toBe(false);
    expect(midformDraftSchema.safeParse({ ...draft, silencePreset: "relaxed" }).success).toBe(false);
  });
});
