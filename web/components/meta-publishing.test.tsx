import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { MetaPublishingPanel } from "./meta-publishing";

const language = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => language }));
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

async function render(connected: boolean, locale = "en", channel = false) {
  language.locale = locale;
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  Object.defineProperty(window, "location", { configurable: true, value: { href: channel ? "https://www.easycut.co.kr/en/publish/channels" : "http://localhost:3002/en/projects/1", pathname: channel ? "/en/publish/channels" : "/en/projects/1", assign: vi.fn() } });
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith("/oauth/start")) return Response.json({ authorizationUrl: "https://www.instagram.com/oauth/authorize" });
    if (url.includes("/posts")) return Response.json({ posts: [] });
    return Response.json({ connections: connected ? [{ id: "connection-a", nickname: "Saved account name", username: "owner", status: "active" }] : [], oauthReady: connected, retryAfterSeconds: 0 });
  }));
  const container = document.getElementById("app")!;
  root = createRoot(container as unknown as Element);
  await act(async () => { root!.render(<MetaPublishingPanel platform="instagram" shortId={channel ? undefined : "short-a"} title="My original clip"/>); });
  return { container, calls };
}
describe("Meta upload intent and localized UI", () => {
  it("connects directly from channel management without a short or upload request", async () => {
    const { container, calls } = await render(true, "en", true);
    expect(calls).toEqual(["/api/social/instagram"]);
    expect(container.textContent).toContain("@owner");
    expect(container.querySelector("video")).toBeNull();
    const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "Connect account")!;
    expect(button.hasAttribute("disabled")).toBe(false);
    await act(async () => button.click());
    expect(fetch).toHaveBeenLastCalledWith("/api/social/instagram/oauth/start", expect.objectContaining({ method: "POST", body: JSON.stringify({ returnPath: "/en/publish/channels" }) }));
    expect(window.location.assign).toHaveBeenCalledWith("https://www.instagram.com/oauth/authorize");
    expect(calls.some(url => url.includes("/posts"))).toBe(false);
  });
  it("starts with unchecked consent and an explicit public Reel notice", async () => {
    const {container,calls}=await render(true);
    expect(container.textContent).toContain("Professional account Reels are public");
    expect(container.textContent).toContain("@owner");
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    expect(Array.from(container.querySelectorAll('input[type="checkbox"]')).every(input=>!input.hasAttribute("checked"))).toBe(true);
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
    expect(calls.some(url=>url.endsWith("/posts"))).toBe(false);
  });
  it.each(["en","ja"])("renders %s without translated authored content", async locale => {
    const {container}=await render(true,locale);expect(container.textContent).not.toMatch(/[가-힣]/);expect(container.textContent).toContain("My original clip");
  });
  it("does not imply a tester invitation has connected an account", async () => {
    const {container}=await render(false);expect(container.textContent).toContain("Account connection setup is pending");
    expect(Array.from(container.querySelectorAll("button")).find(b=>b.textContent==="Connect account")?.hasAttribute("disabled")).toBe(true);
  });
});
