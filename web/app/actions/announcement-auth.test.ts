import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: mocks.session }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
import { HttpError } from "@/lib/http";
import { claimOnboardingWelcomeAnnouncement } from "./onboarding-welcome";
import { claimEditorLaunchAnnouncement } from "./editor-launch-announcement";
import { claimSidebarNavigationAnnouncement } from "./sidebar-navigation-announcement";
import { claimShortsThankYouEvent } from "./shorts-thank-you-event";

beforeEach(() => vi.clearAllMocks());
const actions = [
  { name: "onboarding", run: claimOnboardingWelcomeAnnouncement, empty: null },
  { name: "editor", run: claimEditorLaunchAnnouncement, empty: null },
  { name: "sidebar", run: claimSidebarNavigationAnnouncement, empty: null },
  { name: "event", run: claimShortsThankYouEvent,
    empty: { enabled: false, welcomeClaimed: false, rewardAvailable: false } },
];
it.each(actions)("$name skips an expired login without recording a receipt", async ({ run, empty }) => {
  mocks.session.mockRejectedValue(new HttpError(401, "로그인이 필요합니다."));
  await expect(run()).resolves.toEqual(empty);
  expect(mocks.getDb).not.toHaveBeenCalled();
});
it.each(actions)("$name preserves non-authentication failures", async ({ run }) => {
  const error = new Error("database unavailable");
  mocks.session.mockRejectedValue(error);
  await expect(run()).rejects.toBe(error);
  expect(mocks.getDb).not.toHaveBeenCalled();
});
