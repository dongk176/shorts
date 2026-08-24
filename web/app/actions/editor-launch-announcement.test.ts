import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { claimEditorLaunchAnnouncement } from "./editor-launch-announcement";

const userId = "6f856acc-5b6a-4f62-9971-d7feb1f2a624";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ userId });
});

describe("editor launch announcement claim", () => {
  it("returns and atomically marks the eligible account announcement once", async () => {
    const db = vi.fn().mockResolvedValue([{
      campaignCode: "editor_launch_20260728",
      grantedSeconds: 7200,
      validUntil: new Date("2026-10-26T06:00:00.000Z"),
    }]);
    mocks.getDb.mockReturnValue(db);

    await expect(claimEditorLaunchAnnouncement()).resolves.toEqual({
      campaignCode: "editor_launch_20260728",
      grantedSeconds: 7200,
      validUntil: "2026-10-26T06:00:00.000Z",
    });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("returns null for free, late-paying, expired, or already-presented accounts", async () => {
    const db = vi.fn().mockResolvedValue([]);
    mocks.getDb.mockReturnValue(db);

    await expect(claimEditorLaunchAnnouncement()).resolves.toBeNull();
  });
});
