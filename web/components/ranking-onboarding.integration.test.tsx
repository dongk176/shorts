import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, useEffect, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { RankingOnboarding } from "./ranking-onboarding-preview";
import { WelcomeOverlayQueueProvider, useWelcomeOverlayStage } from "./welcome-overlay-queue";
import { ProjectFeedbackOverlay } from "./project-feedback-overlay";
const state = vi.hoisted(() => ({ path: "/", authenticated: true, accountId: "account-a", rankingAvailable: true }));
vi.mock("@/components/usage-provider", () => ({ useUsageState: () => state }));
vi.mock("@/lib/i18n/navigation", () => ({ usePathname: () => state.path }));
vi.mock("@/lib/i18n/use-ui-text", () => ({ useUiText: () => (text: string) => text }));
vi.mock("@/lib/usage-client", () => ({ publishUsageSnapshot: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("./feature-guide-overlay", () => ({ FeatureGuideOverlay: () => <div>ranking guide</div> }));
let root: Root;
function EarlierNotices() {
  const a = useWelcomeOverlayStage("onboarding"), b = useWelcomeOverlayStage("existing-welcome"), c = useWelcomeOverlayStage("sidebar-navigation"), d = useWelcomeOverlayStage("marketing-email");
  useEffect(() => { for (const stage of [a,b,c,d]) if(stage.active) stage.complete(); }, [a,b,c,d]);
  return null;
}
beforeEach(() => {
  state.path = "/";
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  const values = new Map<string,string>();
  const storage = { getItem: (k:string) => values.get(k) ?? null, setItem:(k:string,v:string)=>values.set(k,v), removeItem:(k:string)=>values.delete(k) };
  Object.assign(window.HTMLElement.prototype, { showModal(this: HTMLElement){this.setAttribute("open","");},close(this: HTMLElement){this.removeAttribute("open");},play(){return Promise.resolve();},pause(){} });
  vi.stubGlobal("window",window); vi.stubGlobal("document",document); vi.stubGlobal("HTMLElement",window.HTMLElement); vi.stubGlobal("HTMLMediaElement",window.HTMLElement);
  vi.stubGlobal("localStorage",storage); Object.defineProperty(window,"sessionStorage",{configurable:true,value:storage});
  vi.stubGlobal("matchMedia",()=>({ matches:false,addEventListener(){},removeEventListener(){} })); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({eligible:true})));
  root=createRoot(document.getElementById("app")!);
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
async function render(studio=false) {
  await act(async()=>root.render(<WelcomeOverlayQueueProvider><EarlierNotices/><ProjectFeedbackOverlay/><RankingOnboarding mode="home"/>{studio && <RankingOnboarding mode="studio" ownerId="account-a"/>}</WelcomeOverlayQueueProvider>));
}
it("shows launch before feedback waits for a viewed project, and dismisses without repeating",async()=>{
  await render();
  expect(document.querySelector("dialog[open]")?.textContent).toContain("랭킹 쇼츠가 출시됐어요!");
  await act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="안내 닫기"]')!.click());
  expect(document.querySelector("dialog")).toBeNull();
  await render();
  expect(document.querySelector("dialog")).toBeNull();
});
it("lets studio own the stage on direct entry and starts the guide",async()=>{
  state.path="/ranking-shorts";
  await render(true);
  expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
  expect(document.querySelector("dialog")?.textContent).toContain("시작하기 전에");
  await act(async()=>Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(x=>x.textContent?.includes("1분 사용법 보기"))!.click());
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.body.textContent).toContain("ranking guide");
});

it("opens beta after client navigation from a dismissed home launch",async()=>{
  await render();
  await act(async()=>document.querySelector<HTMLButtonElement>('button[aria-label="안내 닫기"]')!.click());
  state.path="/ranking-shorts";
  await render(true);
  expect(document.querySelector("dialog[open]")?.textContent).toContain("시작하기 전에");
});
