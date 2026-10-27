import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { UsageProvider, type UsageState } from "./usage-provider";
import { WelcomeOverlayQueueProvider } from "./welcome-overlay-queue";
import { YoutubeLaunchAnnouncement } from "./youtube-launch-announcement";
import { UserOnboardingOverlay } from "./user-onboarding-overlay";
import { EditorLaunchAnnouncementOverlay } from "./editor-launch-announcement-overlay";
import { SidebarNavigationAnnouncement } from "./sidebar-navigation-announcement";
import { MarketingEmailPreferenceOverlay } from "./marketing-email-preference-overlay";
import { RankingOnboarding } from "./ranking-onboarding-preview";
import { ProjectFeedbackOverlay } from "./project-feedback-overlay";
import { PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY, markCompletedProjectViewedForFeedback } from "@/lib/project-feedback-client";

vi.mock("@/lib/i18n/use-ui-text", () => ({ useUiText: () => (text: string) => text }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ locale: "ko", t: (key: string) => key }) }));
vi.mock("@/lib/i18n/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/actions/onboarding-welcome", () => ({ claimOnboardingWelcomeAnnouncement: async () => null }));
vi.mock("@/app/actions/editor-launch-announcement", () => ({ claimEditorLaunchAnnouncement: async () => null }));
vi.mock("@/app/actions/sidebar-navigation-announcement", () => ({ claimSidebarNavigationAnnouncement: async () => null }));
let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

async function hydrate(authenticated = true) {
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", window.HTMLElement); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: storage });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener(){}, removeEventListener(){} }));
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener(){}, removeEventListener(){} }) });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  // This is the session marker retained across ProjectPage's location.assign back to home.
  markCompletedProjectViewedForFeedback("account-a", 123, storage);
  let resolveUsage!: (response: Response) => void;
  const pendingUsage = new Promise<Response>(resolve => { resolveUsage = resolve; });
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/mvp/usage") return pendingUsage;
    if (url === "/api/onboarding") return Response.json({ required: false });
    if (url === "/api/account/marketing-email-preference") return Response.json({ available: true, eligible: true, status: "declined" });
    if (url === "/api/project-feedback") return Response.json({ eligible: true, submitted: false, permanentlyDismissed: false,
      completedProjectCount: 1, promptCompletionCount: 1, rewardSeconds: 1800, rewardValidityDays: 90 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  root = createRoot(document.getElementById("app")! as unknown as Element);
  await act(async () => root!.render(
    <UsageProvider initialState={{ authenticated, accountId: null, isEnterprise: false, usage: null }}>
      <WelcomeOverlayQueueProvider>
        <YoutubeLaunchAnnouncement /><UserOnboardingOverlay /><EditorLaunchAnnouncementOverlay />
        <SidebarNavigationAnnouncement /><MarketingEmailPreferenceOverlay /><RankingOnboarding mode="home"/><ProjectFeedbackOverlay />
      </WelcomeOverlayQueueProvider>
    </UsageProvider>,
  ));
  return { storage, fetcher, resolve: async (accountId: string) => {
    await act(async () => resolveUsage(Response.json({ authenticated: true, accountId, isEnterprise: false, rankingAvailable: false,
      usage: { usedSeconds: 1, reservedSeconds: 0, remainingSeconds: 1800 } } as UsageState)));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
  } };
}

it("preserves a result view during signed-in account hydration and reaches feedback through every real notice", async () => {
  const { storage, fetcher, resolve } = await hydrate();
  expect(storage.getItem(PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY)).not.toBeNull();
  expect(fetcher.mock.calls.some(([url]) => url === "/api/project-feedback")).toBe(false);
  await resolve("account-a");
  expect(fetcher.mock.calls.some(([url]) => url === "/api/project-feedback")).toBe(true);
  expect(document.querySelector('[aria-labelledby="project-feedback-title"]')).not.toBeNull();
});
it("clears another account's marker once the authenticated identity resolves", async () => {
  const { storage, fetcher, resolve } = await hydrate();
  await resolve("account-b");
  expect(storage.getItem(PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY)).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => url === "/api/project-feedback")).toBe(false);
});
it("still clears the marker for a signed-out visitor", async () => {
  const { storage } = await hydrate(false);
  expect(storage.getItem(PROJECT_FEEDBACK_PROJECT_VIEWED_STORAGE_KEY)).toBeNull();
});
