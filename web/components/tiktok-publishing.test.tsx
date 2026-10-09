import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { TikTokPublishingPanel, tiktokRequest } from "./tiktok-publishing";

const language = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => language }));
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

async function render(connected: boolean, locale = "en", error = false, approved = false, query = "") {
  language.locale = locale;
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  Object.defineProperty(window, "location", { configurable: true, value: { href: "http://localhost:3002/en/projects/1"+query, pathname: "/en/projects/1" } });
  Object.defineProperty(window, "history", { configurable: true, value: { state: null, replaceState: vi.fn() } });
  vi.stubGlobal("window", window); vi.stubGlobal("document", document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes("/creator")) return error ? Response.json({ code: "TIKTOK_ACCESS_TOKEN_INVALID" }, { status: 502 }) : Response.json({ creator: { connectionId: "connection-a", nickname: "Fresh TikTok name", username: "owner", fetchedAtMs: Date.now(), privacyOptions: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], commentDisabled: true, duetDisabled: true, stitchDisabled: false, maxDurationSeconds: 60 }, durationSeconds: 15, auditApproved: approved, mediaReady: true });
    if (url.includes("/posts")) return Response.json({ posts: [] });
    return Response.json({ connections: connected ? [{ id: "connection-a", nickname: "Saved account name", username: "owner", status: "active" }] : [], oauthReady: connected, retryAfterSeconds: 0 });
  }));
  const container = document.getElementById("app")!;
  root = createRoot(container as unknown as Element);
  await act(async () => { root!.render(<TikTokPublishingPanel shortId="short-a" title="My original clip"/>); });
  return { container, calls };
}
describe("TikTok upload form from client API responses", () => {
  it("fetches fresh creator settings and leaves privacy, interactions and consent unselected", async () => {
    const { container, calls } = await render(true);
    expect(calls.some(url => url.endsWith("/creator"))).toBe(true);
    expect(container.textContent).toContain("Fresh TikTok name");
    const privacy = Array.from(container.querySelectorAll("select")).find(select => select.id.endsWith("-privacy"))!;
    expect(privacy.querySelector("option[selected]")?.getAttribute("value")).toBe("");
    expect(privacy.querySelector('option[value="PUBLIC_TO_EVERYONE"]')?.hasAttribute("disabled")).toBe(true);
    expect(Array.from(container.querySelectorAll('input[type="checkbox"]')).every(input => !input.hasAttribute("checked"))).toBe(true);
    expect(Array.from(container.querySelectorAll('input[type="checkbox"]')).filter(input => input.hasAttribute("disabled"))).toHaveLength(2);
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector("video")?.getAttribute("src")).toContain("/api/social/tiktok/preview/short-a");
    expect(container.querySelector('a[href*="music-usage-confirmation"]')).not.toBeNull();
    expect(calls.some(url => url.endsWith("/posts"))).toBe(false);
  });
  it("enables the approved public option without choosing privacy or consent for the user", async () => {
    const { container, calls } = await render(true, "en", false, true);
    const privacy = Array.from(container.querySelectorAll("select")).find(select => select.id.endsWith("-privacy"))!;
    expect(privacy.querySelector('option[value="PUBLIC_TO_EVERYONE"]')?.hasAttribute("disabled")).toBe(false);
    expect(privacy.querySelector("option[selected]")?.getAttribute("value")).toBe("");
    expect(container.textContent).not.toContain("This test supports Only me");
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
    expect(calls.some(url => url.endsWith("/posts"))).toBe(false);
  });
  it.each(["en", "ja"])("renders %s text immediately and preserves authored titles", async locale => {
    const { container } = await render(true, locale);
    expect(container.textContent).not.toMatch(/[가-힣]/);
    expect(container.textContent).toContain("My original clip");
  });
  it("shows missing setup without pretending the developer login connected an account", async () => {
    const { container } = await render(false);
    expect(container.textContent).toContain("HTTPS callback and app credentials");
    expect(Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Connect TikTok")?.hasAttribute("disabled")).toBe(true);
  });
  it("blocks uploading and offers reload after creator lookup failure", async () => {
    const { container } = await render(true, "en", true);
    expect(container.textContent).toContain("Reconnect required");
    expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  });
  it("shows a prominent specific connection failure and safe reference after OAuth return", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const { container, calls } = await render(false, "ko", false, true, `?tiktokAccount=failed&tiktokError=TIKTOK_ALREADY_LINKED&tiktokRequest=${requestId}`);
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("TikTok 연결을 완료하지 못했어요");
    expect(alert.textContent).toContain("다른 이지컷 계정에 연결");
    expect(alert.textContent).toContain(requestId);
    expect(alert.className).toContain("publish-error-notice");
    expect(calls.some(url => /oauth|posts$/.test(url))).toBe(false);
    const cleanUrl = vi.mocked(window.history.replaceState).mock.calls[0][2];
    expect(String(cleanUrl)).not.toMatch(/tiktokAccount|tiktokError|tiktokRequest/);
  });
  it("never displays arbitrary URL failure text and explains unconfirmed cleanup", async () => {
    const { container } = await render(false, "en", false, true, "?tiktokAccount=revoke_required&tiktokError=private-token&tiktokRequest=secret");
    expect(container.textContent).toContain("could not identify the exact cause");
    expect(container.textContent).toContain("could not confirm revocation");
    expect(container.textContent).not.toMatch(/private-token|secret/);
  });
  it("turns network and malformed responses into safe errors instead of invalid translation keys", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("private-network-details")));
    await expect(tiktokRequest("/oauth/start", {})).rejects.toThrow("TIKTOK_NETWORK_ERROR");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-html", { status: 502 })));
    await expect(tiktokRequest("/oauth/start", {})).rejects.toThrow("TIKTOK_INVALID_RESPONSE");
  });

});
