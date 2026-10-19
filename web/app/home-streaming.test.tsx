import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/lib/i18n/metadata", () => ({ createLocalizedPageMetadata: () => ({}) }));
vi.mock("@/lib/mvp-state", () => ({ loadMvpState: mocks.load }));
vi.mock("@/lib/i18n/server", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/paddle/config", () => ({ paddleConfigured: () => false, paddleEnabled: () => false }));
vi.mock("./shorts-app", () => ({ ShortsApp: () => <div>account ready</div> }));
vi.mock("@/components/enterprise-service-gate", () => ({ EnterpriseServiceGate: () => <div>restricted</div> }));
import Home from "./page";

describe("home loading boundary", () => {
  it("returns the page shell before starting the account read and provides localized fallback content", async () => {
    const element = await Home();
    expect(mocks.load).not.toHaveBeenCalled();
    // This checks the fallback content; actual streaming timing is a Next runtime concern.
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Loading your account");
    expect(html).toContain("Create AI Shorts");
    expect(mocks.load).toHaveBeenCalledWith(undefined, undefined, "en", { includeRecentJobs: false });
  });
});
