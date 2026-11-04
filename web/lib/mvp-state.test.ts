vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  silence: vi.fn(), auth: vi.fn(), session: vi.fn(), jobs: vi.fn(), examples: vi.fn(), enterprise: vi.fn(),
}));
vi.mock("./shorts-silence-access", () => ({ shortsSilenceAccessEnabled: m.silence }));
vi.mock("./read-request", () => ({ withReadRequest: (_name: string, run: (stage: (n: string, fn: () => Promise<unknown>) => Promise<unknown>) => unknown) => run((_n, fn) => fn()) }));
vi.mock("./db", () => ({ getDb: () => ({}) }));
vi.mock("./supabase/server", () => ({ getAuthenticatedUser: m.auth }));
vi.mock("./session", () => ({ requireMvpSession: m.session }));
vi.mock("./data", () => ({
  getPublicMvpState: async () => ({ plans: [{ code: "free", monthlySourceSeconds: 60 }], generatedShortCount: 10, reusableViewCounter: null }),
  getRecentJobs: m.jobs, getPublicExampleJobs: m.examples, getSubtitleTemplateUsage: async () => false,
}));
vi.mock("./billing", () => ({ getBillingSummary: async () => ({ planCode: "free", canCreateJobs: false }) }));
vi.mock("./billing-payment-method-remediation", () => ({ getPaymentMethodAction: async () => null }));
vi.mock("./usage", () => ({ currentKstPeriod: () => ({ start: new Date(0), next: new Date(1) }), isPlanEnforcementEnabled: () => true, getUsageSnapshot: async () => ({ remainingSeconds: 30 }) }));
vi.mock("./enterprise-access", () => ({ getEnterpriseAccessState: m.enterprise }));
vi.mock("./file-upload-release", () => ({ getFileUploadReleaseAccess: async () => ({ enabled: false, adminEnabled: false }) }));
vi.mock("./custom-template-design-access", () => ({ getCustomTemplateDesignAccess: async () => ({ enabled: false }) }));
vi.mock("./subtitle-template-release", () => ({ getEffectiveSubtitleTemplateAccess: async () => ({ unifiedEnabled: false }), unifiedTemplateSubtitleLocalUploadEnabled: () => false }));
vi.mock("./sns-template-release", () => ({ snsTemplateRelease: async () => ({}) }));
vi.mock("./language-test", () => ({ languageTestStatus: async () => ({}), languageFeatureAllowed: () => false }));
import { loadMvpState, loadMvpRecentJobs } from "./mvp-state";

beforeEach(() => {
  vi.clearAllMocks();
  m.silence.mockResolvedValue(false);
  m.auth.mockResolvedValue({ id: "auth-a" });
  m.session.mockResolvedValue({ id: "session", userId: "app-a", user: { id: "auth-a" }, isEnterprise: false });
  m.jobs.mockResolvedValue([{ id: "project" }]); m.examples.mockResolvedValue([{ id: "example" }]);
  m.enterprise.mockResolvedValue({ accountType: "enterprise", allowed: false });
});
describe("home core and projects are independently bounded reads", () => {
  it("returns account, usage and release gates without waiting for a hanging project query", async () => {
    m.jobs.mockImplementation(() => new Promise(() => {}));
    const core = await loadMvpState(undefined, undefined, "ko", { includeRecentJobs: false });
    expect(m.jobs).not.toHaveBeenCalled();
    expect(core.user?.id).toBe("auth-a");
    expect(core.usage.remainingSeconds).toBe(30);
    expect(core.capabilities.fileUpload).toBe(false);
    expect(core.recentJobsLoaded).toBe(false);
  });
  it("shows public silence to an ordinary member while keeping midform private", async () => {
    m.silence.mockResolvedValue(true);
    const result = await loadMvpState();
    expect(result.capabilities.shortsSilenceRemoval).toBe(true);
    expect(result.capabilities.midform).toBe(false);
    expect(m.silence).toHaveBeenCalledWith({}, "app-a");
  });
  it("preserves the full-state contract for existing API consumers", async () => {
    expect((await loadMvpState()).recentJobs).toEqual([{ id: "project" }]);
    expect(m.jobs).toHaveBeenCalledOnce();
  });
  it("can retry a failed project read without loading billing or replacing core data", async () => {
    m.jobs.mockRejectedValueOnce(new Error("timeout"));
    await expect(loadMvpRecentJobs()).rejects.toThrow("timeout");
    await expect(loadMvpRecentJobs()).resolves.toMatchObject({ userId: "auth-a", recentJobs: [{ id: "project" }] });
  });
  it("keeps guest reads locale-specific and never reads private jobs", async () => {
    m.auth.mockResolvedValue(null);
    await loadMvpState(undefined, undefined, "ja", { includeRecentJobs: false });
    expect(m.examples).not.toHaveBeenCalled();
    await expect(loadMvpRecentJobs(undefined, "ja")).resolves.toMatchObject({ userId: null });
    expect(m.examples).toHaveBeenCalledWith({}, "ja");
    expect(m.jobs).not.toHaveBeenCalled();
    expect(m.session).not.toHaveBeenCalled();
  });
  it("keeps enterprise restrictions and read-only session access", async () => {
    m.session.mockResolvedValue({ userId: "app-a", user: { id: "auth-a" }, isEnterprise: true });
    await loadMvpRecentJobs();
    expect(m.jobs).not.toHaveBeenCalled();
    expect(m.session).toHaveBeenCalledWith({ id: "auth-a" }, { createIfMissing: false, readOnly: true });
    const core = await loadMvpState(undefined, undefined, "ko", { includeRecentJobs: false });
    expect(core.enterpriseAccess.allowed).toBe(false);
  });
});
