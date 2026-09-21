import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { MetaPublishingPanel } from "./meta-publishing";

const language = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => language }));
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

async function render(connected: boolean, locale = "en") {
  language.locale = locale;
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  Object.defineProperty(window, "location", { configurable: true, value: { href: "http://localhost:3002/en/projects/1", pathname: "/en/projects/1" } });
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes("/posts")) return Response.json({ posts: [] });
    return Response.json({ connections: connected ? [{ id: "connection-a", nickname: "Saved account name", username: "owner", status: "active" }] : [], oauthReady: connected, retryAfterSeconds: 0 });
  }));
  const container = document.getElementById("app")!;
  root = createRoot(container as unknown as Element);
  await act(async () => { root!.render(<MetaPublishingPanel platform="instagram" shortId="short-a" title="My original clip"/>); });
  return { container, calls };
}
describe("Meta upload intent and localized UI", () => {
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
