import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));

import { claimSidebarNavigationAnnouncement } from "./sidebar-navigation-announcement";
import { readFileSync } from "node:fs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    userId: "6f856acc-5b6a-4f62-9971-d7feb1f2a624",
  });
});

describe("sidebar navigation announcement claim", () => {
  it("keeps the campaign disabled and uses an account-campaign unique receipt", () => {
    const migration = readFileSync(
      new URL(
        "../../../supabase/migrations/202607310004_sidebar_navigation_announcement.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain("enabled boolean not null default false");
    expect(migration).toContain("primary key (user_id,campaign_code)");
    expect(migration).toContain("'sidebar_navigation_v1'");
  });

  it("returns the campaign only when the atomic insert succeeds", async () => {
    const db = vi.fn().mockResolvedValue([{
      campaignCode: "sidebar_navigation_v1",
    }]);
    mocks.getDb.mockReturnValue(db);

    await expect(claimSidebarNavigationAnnouncement()).resolves.toEqual({
      campaignCode: "sidebar_navigation_v1",
    });
    expect(db).toHaveBeenCalledTimes(1);
    expect(db.mock.calls[0][0].join("?")).toContain(
      "u.created_at<c.eligibility_cutoff",
    );
    expect(db.mock.calls[0][0].join("?")).toContain(
      "on conflict (user_id,campaign_code) do nothing",
    );
  });

  it("returns null for new members, disabled campaigns, and repeated tabs", async () => {
    mocks.getDb.mockReturnValue(vi.fn().mockResolvedValue([]));

    await expect(claimSidebarNavigationAnnouncement()).resolves.toBeNull();
  });
});
