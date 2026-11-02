vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  paddle: {
    providerStatus: "active",
    planCode: "paddle_lite",
    currentPeriodEnd: "2026-10-26T00:00:00Z",
    cancelAtPeriodEnd: false,
  },
  billing: { paymentProvider: "paddle", status: "active" },
}));
vi.mock("@/lib/i18n/server", () => ({
  getRequestLocale: async () => "ja",
  localizedRedirectPath: async (path: string) => path,
}));
vi.mock("@/lib/paddle/config", () => ({ paddleConfigured: () => true }));
vi.mock("@/lib/paddle/service", () => ({
  getPaddleState: async () => state.paddle,
}));
vi.mock("@/components/paddle-page", () => ({ PaddlePage: () => null }));
vi.mock("@/lib/billing", () => ({
  getBillingSummary: async () => state.billing,
}));
vi.mock("@/lib/billing-cohort", () => ({
  resolveBillingCustomerCohort: async () => ({}),
  shouldUseTossBillingExperience: () => true,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/session", () => ({
  requireMvpSession: async () => ({ userId: "owner", isEnterprise: false }),
  authProfile: () => ({}),
}));
vi.mock("@/lib/supabase/server", () => ({
  getAuthenticatedUser: async () => ({ id: "owner" }),
}));
vi.mock("@/lib/toss-billing-state", () => ({
  getTossBillingState: async () => ({ provider: "toss" }),
}));
vi.mock("./plan-management-client", () => ({
  PlanManagementClient: () => null,
}));
vi.mock("./enterprise-plan-management", () => ({
  EnterprisePlanManagement: () => null,
}));
import Page from "./page";
import { PaddlePage } from "@/components/paddle-page";
import { PlanManagementClient } from "./plan-management-client";

beforeEach(() => {
  state.paddle.providerStatus = "active";
  state.billing = { paymentProvider: "paddle", status: "active" };
});
describe("subscription management provider routing", () => {
  it("opens Paddle management for an existing Paddle subscriber", async () => {
    expect((await Page()).type).toBe(PaddlePage);
  });
  it("does not let a historical canceled Paddle subscription hide a newer domestic subscription", async () => {
    state.paddle.providerStatus = "canceled";
    state.billing = { paymentProvider: "toss", status: "active" };
    expect((await Page()).type).toBe(PlanManagementClient);
  });
});
