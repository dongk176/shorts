import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { HomeHero, HomeHeroPresentation, PersonalizedHomeHero, japaneseHeroPhrases } from "./home-hero";
import { heroAudienceForOccupation, heroHeadlines } from "@/lib/i18n/hero-headlines";
import { USER_ONBOARDING_UPDATED_EVENT } from "@/lib/user-onboarding";

const account = vi.hoisted(() => ({ accountId: "app-account-a" }));
vi.mock("@/components/usage-provider", () => ({ useUsageState: () => account }));
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const copy = { locale: "ko" as const, fallback: ["기본 제목", "기본 두 번째 줄"] as const, description: "AI가 핵심 장면을 찾아 쇼츠를 만듭니다. 완성 후 편집하세요." };

async function setup(reducedMotion = false) {
  vi.useFakeTimers();
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia = vi.fn(() => ({ matches: reducedMotion, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  root = createRoot(document.getElementById("app")! as unknown as Element);
  const show = async (node: Parameters<Root["render"]>[0]) => { await act(async () => root!.render(node)); };
  const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
  const active = () => document.querySelector('[data-active="true"]')?.textContent;
  const clickToggle = async () => { await act(async () => document.querySelector("button")!.dispatchEvent(new window.Event("click", { bubbles: true }))); };
  const visibility = async (hidden: boolean) => { Object.defineProperty(document, "hidden", { value: hidden, configurable: true }); await act(async () => document.dispatchEvent(new window.Event("visibilitychange"))); };
  return { window, document, show, advance, active, clickToggle, visibility };
}

describe("home headline personalization", () => {
  it.each(["creator", "marketing", "brand", "video_production"] as const)("selects creator copy for %s", occupation => {
    expect(heroAudienceForOccupation(occupation)).toBe("creator");
  });
  it.each(["education", "employee_freelancer"] as const)("selects side-hustle copy for %s", occupation => {
    expect(heroAudienceForOccupation(occupation)).toBe("side_hustle");
  });
  it.each([null, "other"] as const)("does not guess a profession for %s", occupation => {
    expect(heroAudienceForOccupation(occupation)).toBeNull();
  });
  it.each(["ko", "en", "ja"] as const)("has 20 distinct two-line headlines per audience in %s", locale => {
    for (const headlines of Object.values(heroHeadlines[locale])) {
      expect(headlines).toHaveLength(20);
      expect(new Set(headlines.map(lines => lines.join(" "))).size).toBe(20);
      for (const lines of headlines) {
        expect(lines).toHaveLength(2);
        expect(lines.every(line => line.trim() && !/[.。]$/.test(line))).toBe(true);
      }
    }
  });
  it("preserves every Japanese character and keeps grammatical phrases together", () => {
    const text = "AIが見どころを選び、タイトル・字幕付きの30〜60秒のショート動画を作成します。完成後は自由に編集できます。";
    const phrases = japaneseHeroPhrases(text);
    expect(phrases.join("")).toBe(text);
    expect(phrases.length).toBeGreaterThan(2);
    expect(phrases.some(part => part.includes("作成します。"))).toBe(true);
    expect(phrases.some(part => part.includes("ショート動画"))).toBe(true);
    expect(phrases.some(part => part.includes("30〜60秒"))).toBe(true);
    for (const lines of [...heroHeadlines.ja.creator, ...heroHeadlines.ja.side_hustle]) {
      for (const line of lines) {
        const pieces = japaneseHeroPhrases(line);
        expect(pieces.join("")).toBe(line);
        for (let index = 1; index < pieces.length; index++) {
          expect(/[ァ-ヺーｦ-ﾟ]$/u.test(pieces[index - 1]) && /^[ァ-ヺーｦ-ﾟ]/u.test(pieces[index])).toBe(false);
        }
      }
    }
  });
  it("server-renders the original fallback description without inserting forced new lines", () => {
    const html = renderToStaticMarkup(<HomeHeroPresentation {...copy} audience={null} />);
    expect(parseHTML(html).document.querySelector("p")?.textContent).toBe(copy.description);
    expect(html).not.toContain("<br");
    expect(html).not.toContain("<button");
  });
  it("switches every 3 seconds and loops through all 20 without changing its accessible heading", async () => {
    const ui = await setup();
    await ui.show(<HomeHeroPresentation {...copy} audience="creator" />);
    const heading = ui.document.querySelector("h1")!.getAttribute("aria-label");
    await ui.advance(2999);
    expect(ui.active()).toBe(heroHeadlines.ko.creator[0].join(""));
    await ui.advance(1);
    expect(ui.active()).toBe(heroHeadlines.ko.creator[1].join(""));
    for (let index = 2; index <= 20; index++) {
      await ui.advance(3000);
      expect(ui.active()).toBe(heroHeadlines.ko.creator[index % 20].join(""));
    }
    expect(ui.document.querySelector("h1")!.getAttribute("aria-label")).toBe(heading);
  });
  it("pauses while hidden or manually paused and resumes with a full 3 seconds", async () => {
    const ui = await setup();
    await ui.show(<HomeHeroPresentation {...copy} audience="side_hustle" />);
    await ui.advance(1500);
    await ui.visibility(true);
    await ui.advance(30000);
    expect(ui.active()).toBe(heroHeadlines.ko.side_hustle[0].join(""));
    await ui.visibility(false);
    await ui.advance(2999);
    expect(ui.active()).toBe(heroHeadlines.ko.side_hustle[0].join(""));
    await ui.advance(1);
    await ui.clickToggle();
    await ui.advance(15000);
    expect(ui.active()).toBe(heroHeadlines.ko.side_hustle[1].join(""));
    await ui.clickToggle();
    await ui.advance(3000);
    expect(ui.active()).toBe(heroHeadlines.ko.side_hustle[2].join(""));
  });
  it("starts paused for reduced motion, allowing explicit play", async () => {
    const ui = await setup(true);
    await ui.show(<HomeHeroPresentation {...copy} audience="creator" />);
    await ui.advance(12000);
    expect(ui.active()).toBe(heroHeadlines.ko.creator[0].join(""));
    await ui.clickToggle();
    await ui.advance(3000);
    expect(ui.active()).toBe(heroHeadlines.ko.creator[1].join(""));
  });
  it("refreshes the real home immediately after onboarding using the app-account identity", async () => {
    const ui = await setup();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ occupation: null }) });
    vi.stubGlobal("fetch", fetcher);
    await ui.show(<PersonalizedHomeHero {...copy} />);
    expect(ui.active()).toBe(copy.fallback.join(""));
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ occupation: "employee_freelancer" }) });
    await act(async () => { ui.window.dispatchEvent(new ui.window.CustomEvent(USER_ONBOARDING_UPDATED_EVENT, { detail: { accountId: "app-account-a" } })); });
    expect(ui.active()).toBe(heroHeadlines.ko.side_hustle[0].join(""));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("loads only signed-in profiles, reacts to onboarding, resets locale, and does not leak copy across accounts", async () => {
    const ui = await setup();
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ occupation: "creator" }) });
    vi.stubGlobal("fetch", fetcher);
    await ui.show(<HomeHero {...copy} accountId={null} />);
    expect(fetcher).not.toHaveBeenCalled();
    await ui.show(<HomeHero {...copy} accountId="account-a" />);
    expect(ui.active()).toBe(heroHeadlines.ko.creator[0].join(""));
    await ui.advance(6000);
    await ui.show(<HomeHero {...copy} locale="en" accountId="account-a" />);
    expect(ui.active()).toBe(heroHeadlines.en.creator[0].join(""));
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ occupation: "education" }) });
    await act(async () => { ui.window.dispatchEvent(new ui.window.CustomEvent(USER_ONBOARDING_UPDATED_EVENT, { detail: { accountId: "account-a" } })); });
    expect(ui.active()).toBe(heroHeadlines.en.side_hustle[0].join(""));
    fetcher.mockRejectedValue(new Error("Unavailable"));
    await ui.show(<HomeHero {...copy} accountId="account-b" />);
    expect(ui.active()).toBe(copy.fallback.join(""));
    await ui.show(<HomeHero {...copy} accountId={null} />);
    expect(ui.active()).toBe(copy.fallback.join(""));
  });
});
