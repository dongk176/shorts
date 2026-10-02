import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { HomeHero, japaneseHeroPhrases } from "./home-hero";
import { messagesByLocale } from "@/lib/i18n/messages";
import { USER_ONBOARDING_UPDATED_EVENT } from "@/lib/user-onboarding";

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const headlines = {
  ko: ["트렌드를 찾고", "쇼츠로 선점하세요"],
  en: ["Spot trends", "Get ahead with Shorts"],
  ja: ["トレンドを見つけて", "ショート動画で一歩先へ"],
} as const;

describe("fixed home headline", () => {
  it.each(["ko", "en", "ja"] as const)("renders the agreed two-line headline in %s", locale => {
    const messages = messagesByLocale[locale];
    const headline = [messages["home.heroLine1"], messages["home.heroLine2"]] as const;
    expect(headline).toEqual(headlines[locale]);
    const { document } = parseHTML(renderToStaticMarkup(
      <HomeHero locale={locale} headline={headline} description={messages["home.heroDescription"]} />,
    ));
    const heading = document.querySelector("h1")!;
    expect(heading.getAttribute("aria-label")).toBe(headline.join(" "));
    expect(Array.from(heading.children).map(line => line.textContent)).toEqual(headline);
    expect(document.querySelector("p")?.textContent).toBe(messages["home.heroDescription"]);
    expect(document.querySelector("button")).toBeNull();
  });

  it("stays fixed across time and onboarding changes without requesting a profile", async () => {
    vi.useFakeTimers();
    const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    root = createRoot(document.getElementById("app")! as unknown as Element);
    await act(async () => root!.render(<HomeHero locale="ko" headline={headlines.ko} description="설명" />));
    const before = document.querySelector("h1")!.outerHTML;
    await act(async () => {
      window.dispatchEvent(new window.CustomEvent(USER_ONBOARDING_UPDATED_EVENT, { detail: { accountId: "signed-in-account" } }));
      vi.advanceTimersByTime(120_000);
    });
    expect(document.querySelector("h1")!.outerHTML).toBe(before);
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector("button")).toBeNull();
  });

  it("preserves Japanese text and keeps ショート動画 together", () => {
    for (const text of [...headlines.ja, messagesByLocale.ja["home.heroDescription"]]) {
      const phrases = japaneseHeroPhrases(text);
      expect(phrases.join("")).toBe(text);
      if (text.includes("ショート動画")) expect(phrases.some(part => part.includes("ショート動画"))).toBe(true);
    }
  });
});
