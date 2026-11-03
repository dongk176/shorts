import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), app: vi.fn() }));
vi.mock("@/lib/i18n/metadata", () => ({ createLocalizedPageMetadata: () => ({}) }));
vi.mock("@/lib/mvp-state", () => ({ loadMvpState: mocks.load }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/paddle/config", () => ({ paddleConfigured: () => false, paddleEnabled: () => false }));
vi.mock("./shorts-app", () => ({ ShortsApp: (props: unknown) => {
  mocks.app(props);
  return <div>account ready</div>;
} }));
vi.mock("@/components/enterprise-service-gate", () => ({ EnterpriseServiceGate: () => <div>restricted</div> }));
import Home from "./page";

describe("home navigation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("waits for account state instead of replacing the previous page with a loading splash", async () => {
    let finishRead!: (state: null) => void;
    mocks.load.mockReturnValueOnce(new Promise((resolve) => { finishRead = resolve; }));
    let ready = false;
    const pending = Home().then((element) => { ready = true; return element; });
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledWith(undefined, undefined, "en", { includeRecentJobs: false }));
    expect(ready).toBe(false);
    finishRead(null);
    const html = renderToStaticMarkup(await pending);
    expect(html).toContain("account ready");
    expect(html).not.toContain("Loading your account");
    expect(html).not.toContain("Create AI Shorts");
  });

  it.each([null, { id: "administrator", isAdmin: true }])("passes fresh account state to the app (%j)", async (user) => {
    const state = { user, enterpriseAccess: { accountType: "personal", allowed: true } };
    mocks.load.mockResolvedValueOnce(state);
    renderToStaticMarkup(await Home());
    expect(mocks.app).toHaveBeenCalledWith(expect.objectContaining({ initialState: state, initialLocale: "en" }));
  });

  it("keeps restricted enterprise accounts behind the service gate", async () => {
    mocks.load.mockResolvedValueOnce({ enterpriseAccess: { accountType: "enterprise", allowed: false } });
    expect(renderToStaticMarkup(await Home())).toContain("restricted");
    expect(mocks.app).not.toHaveBeenCalled();
  });

  it("keeps client recovery available if the initial account read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.load.mockRejectedValueOnce(new Error("read unavailable"));
      expect(renderToStaticMarkup(await Home())).toContain("account ready");
      expect(mocks.app).toHaveBeenCalledWith(expect.objectContaining({ initialState: null }));
      expect(log).toHaveBeenCalledWith("home_initial_state_failed", { errorName: "Error" });
    } finally {
      log.mockRestore();
    }
  });
});
