import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  project: vi.fn(), end: vi.fn(), sql: vi.fn(), session: vi.fn(),
}));
vi.mock("postgres", () => ({
  default: Object.assign(() => ({
    begin: async (_mode: string, run: (tx: unknown) => unknown) => run(mocks.sql),
    end: mocks.end,
  }), { camel: {} }),
}));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.sql }));
vi.mock("@/lib/data", () => ({
  getProjectByNumber: mocks.project,
  getPublicExampleProjectByNumber: async () => null,
}));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: async () => ({ activeProducts: [] }) }));
vi.mock("@/lib/enterprise-access", () => ({ assertEnterpriseSessionServiceAccess: async () => {} }));
vi.mock("@/lib/subtitle-template-release", () => ({
  getEffectiveSubtitleTemplateAccess: async () => ({ unifiedEnabled: false }),
}));
import { GET } from "./[projectNumber]/route";
const context = { params: Promise.resolve({ projectNumber: "12" }) };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://unused.invalid/test");
  mocks.sql.mockResolvedValue([]);
  mocks.end.mockResolvedValue(undefined);
  mocks.session.mockResolvedValue({ userId: "owner" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("ends a stalled project read and serves a later request without retrying the old one", async () => {
  vi.useFakeTimers();
  mocks.project.mockImplementationOnce(() => new Promise(() => {}));
  const pending = GET(new Request("http://localhost/api/projects/12"), context);
  await vi.advanceTimersByTimeAsync(10_000);
  const response = await pending;
  expect(response.status).toBe(503);
  expect(mocks.end).toHaveBeenCalledWith({ timeout: 0 });
  expect(mocks.project).toHaveBeenCalledTimes(1);
  mocks.project.mockResolvedValue({ projectNumber: 12, shorts: [] });
  expect((await GET(new Request("http://localhost/api/projects/12"), context)).status).toBe(200);
  expect(mocks.session).toHaveBeenCalledWith({ readOnly: true });
});
it("does no database work when the browser has already canceled the request", async () => {
  const controller = new AbortController();
  controller.abort();
  const response = await GET(new Request("http://localhost/api/projects/12", { signal: controller.signal }), context);
  expect(response.status).toBe(503);
  expect(mocks.sql).not.toHaveBeenCalled();
  expect(mocks.session).not.toHaveBeenCalled();
});
