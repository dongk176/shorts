import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { WelcomeOverlayQueueProvider, useWelcomeOverlayStage } from "./welcome-overlay-queue";
import { YoutubeLaunchAnnouncement } from "./youtube-launch-announcement";
import { ProjectFeedbackOverlay } from "./project-feedback-overlay";
import { markCompletedProjectViewedForFeedback } from "@/lib/project-feedback-client";
import type { WelcomeOverlayStage } from "@/lib/welcome-overlay-queue";

const account = vi.hoisted(() => ({ authenticated: true, accountId: null as string | null }));
vi.mock("@/components/usage-provider", () => ({ useUsageState: () => account }));
vi.mock("@/lib/i18n/use-ui-text", () => ({ useUiText: () => (text: string) => text }));
vi.mock("@/lib/i18n/navigation", () => ({ usePathname: () => "/" }));
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); vi.unstubAllGlobals(); });

function Stage({ stage, advance }: { stage: Exclude<WelcomeOverlayStage, "done">; advance: boolean }) {
  const { active, complete } = useWelcomeOverlayStage(stage);
  useEffect(() => { if (active && advance) complete(); }, [active, advance, complete]);
  return active ? <span>{stage}</span> : null;
}
async function setup(authenticated: boolean, accountId: string | null) {
  Object.assign(account, { authenticated, accountId });
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("HTMLElement", window.HTMLElement); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("app")! as unknown as Element);
  return async (advance = true) => {
    await act(async () => root.render(<WelcomeOverlayQueueProvider>
      <YoutubeLaunchAnnouncement />
      {(["onboarding", "existing-welcome", "sidebar-navigation", "marketing-email", "feedback"] as const).map(stage =>
        <Stage key={stage} stage={stage} advance={advance && stage !== "feedback"} />)}
    </WelcomeOverlayQueueProvider>));
    return document.body.textContent;
  };
}
describe("welcome queue feedback reachability", () => {
  it("reaches feedback when earlier notices complete synchronously on initial signed-in load", async () => {
    const render = await setup(true, null);
    expect(await render()).toBe("feedback");
    account.accountId = "account-a";
    expect(await render()).toBe("feedback");
  });
  it("starts required onboarding for each newly resolved account", async () => {
    const render = await setup(true, "account-a");
    expect(await render()).toBe("feedback");
    account.accountId = "account-b";
    expect(await render(false)).toBe("onboarding");
  });
  it("keeps guests quiet and resumes the queue after sign-in", async () => {
    const render = await setup(false, null);
    expect(await render()).toBe("");
    Object.assign(account, { authenticated: true, accountId: "account-a" });
    expect(await render()).toBe("feedback");
    Object.assign(account, { authenticated: false, accountId: null });
    expect(await render()).toBe("");
  });
  it("opens the actual feedback form for an eligible account after a result view", async () => {
    await setup(true, "account-a");
    const values = new Map<string, string>();
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    markCompletedProjectViewedForFeedback("account-a", 123);
    const fetcher = vi.fn(async () => Response.json({ eligible: true, submitted: false, permanentlyDismissed: false,
      completedProjectCount: 1, promptCompletionCount: 1, rewardSeconds: 1800, rewardValidityDays: 90 }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<WelcomeOverlayQueueProvider>
      <YoutubeLaunchAnnouncement />
      {(["onboarding", "existing-welcome", "sidebar-navigation", "marketing-email"] as const).map(stage =>
        <Stage key={stage} stage={stage} advance />)}
      <ProjectFeedbackOverlay />
    </WelcomeOverlayQueueProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
    expect(fetcher).toHaveBeenCalledWith("/api/project-feedback", expect.objectContaining({ cache: "no-store" }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector("form")).not.toBeNull();
  });
});
