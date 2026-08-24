import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { claimOnboardingWelcomeAnnouncement } from "./onboarding-welcome";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId });
});

describe("onboarding welcome announcement claim", () => {
  it("atomically returns the pending grant announcement once", async () => {
    const db = vi.fn().mockResolvedValue([{
      campaignCode: "onboarding_welcome_v1",
      grantedSeconds: 1_200,
      validUntil: new Date("2026-08-27T06:00:00.000Z"),
    }]);
    mocks.getDb.mockReturnValue(db);

    await expect(claimOnboardingWelcomeAnnouncement()).resolves.toEqual({
      campaignCode: "onboarding_welcome_v1",
      grantedSeconds: 1_200,
      validUntil: "2026-08-27T06:00:00.000Z",
    });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("returns null after presentation or when no spendable grant remains", async () => {
    mocks.getDb.mockReturnValue(vi.fn().mockResolvedValue([]));

    await expect(claimOnboardingWelcomeAnnouncement()).resolves.toBeNull();
  });
});
