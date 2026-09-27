import { describe, expect, it } from "vitest";
import { isLocalizedPage, localePath, localizedHref, localizedReturnUrl } from "./routing";
import { createPageMetadata } from "../seo";

// Route changes must never turn language into API/auth/admin access or a new host.
describe("site language routes", () => {
  it.each([["/", "ko", "/"], ["/en", "en", "/"], ["/jp", "ja", "/"], ["/jp/projects/23", "ja", "/projects/23"], ["/english", "ko", "/english"]])("resolves %s", (path, locale, page) => {
    expect(localePath(path)).toMatchObject({ locale, pathname: page });
  });
  it("switches the same page without losing query strings or anchors", () => {
    expect(localizedHref("/en/pricing?cycle=yearly&next=%2F#plans", "ja")).toBe("/jp/pricing?cycle=yearly&next=%2F#plans");
    expect(localizedHref("/jp?draft=1#workspace", "ko")).toBe("/?draft=1#workspace");
    expect(localizedHref("/jp", "en")).toBe("/en");
  });
  it("keeps login on the shared endpoint and localizes its return page", () => {
    const login = new URL(localizedHref("/auth/sign-in?provider=google&next=%2Ftemplates%2Fnew%3Fbase%3Dpaper%23design", "ja"), "https://local.invalid");
    expect(login.pathname).toBe("/auth/sign-in");
    expect(login.searchParams.get("provider")).toBe("google");
    expect(login.searchParams.get("next")).toBe("/jp/templates/new?base=paper#design");
    expect(localizedHref("/auth/sign-in", "en")).toBe("/auth/sign-in?next=%2Fen");
    expect(localizedHref("/auth/sign-in?next=%2Fjp%2Fprojects", "ko")).toBe("/auth/sign-in?next=%2Fprojects");
  });
  it.each(["/admin/easycutcutcutcutcutcut", "/enterprise-pay/token", "/auth/sign-in?next=/projects", "//external.example/projects", "https://external.example/projects"])("does not rewrite shared or external login destination %s", (next) => {
    const href = `/auth/sign-in?next=${encodeURIComponent(next)}`;
    expect(localizedHref(href, "ja")).toBe(href);
  });
  it.each(["/api/jobs", "/auth/callback?code=x", "/admin/easycutcutcutcutcutcut", "/east-cut-logo.png", "/creator-project/share-token", "/content-calendar", "//external.example", "https://example.com", "#results"])('leaves shared and external address %s alone', (path) => {
    expect(localizedHref(path, "ja")).toBe(path);
    expect(isLocalizedPage(path)).toBe(false);
  });
  it("uses the URL language in canonical and hreflang", () => {
    const metadata = createPageMetadata({ title: "Pricing", description: "Plans", path: "/pricing", locale: "ja" });
    expect(metadata.alternates).toEqual({ canonical: "https://www.easycut.co.kr/jp/pricing", languages: { ko: "https://www.easycut.co.kr/pricing", en: "https://www.easycut.co.kr/en/pricing", ja: "https://www.easycut.co.kr/jp/pricing", "x-default": "https://www.easycut.co.kr/pricing" } });
  });
});

it("keeps payment return tokens and limits rewriting to the current origin", () => {
  expect(localizedReturnUrl("https://www.easycut.co.kr/billing/toss/success?checkoutId=x&state=a%2Fb", "ja", "https://www.easycut.co.kr")).toBe("https://www.easycut.co.kr/jp/billing/toss/success?checkoutId=x&state=a%2Fb");
  expect(localizedReturnUrl("https://provider.example/callback?token=x", "en", "https://www.easycut.co.kr")).toBe("https://provider.example/callback?token=x");
});

it("uses production language prefixes for the monetization guide and its SEO", () => {
  const path = "/shorts-monetization";
  expect(isLocalizedPage(path)).toBe(true);
  for (const [locale, prefix] of [["ko", ""], ["en", "/en"], ["ja", "/jp"]] as const) {
    expect(localizedHref(`${path}?from=guide#ways`, locale)).toBe(`${prefix}${path}?from=guide#ways`);
    const metadata = createPageMetadata({ title: "Guide", description: "Start here", path, locale });
    expect(metadata.alternates?.canonical).toBe(`https://www.easycut.co.kr${prefix}${path}`);
    expect(metadata.alternates?.languages).toMatchObject({ en: `https://www.easycut.co.kr/en${path}`, ja: `https://www.easycut.co.kr/jp${path}` });
  }
});

it("localizes saved video navigation and login return URLs", () => {
  expect(localizedHref("/saved-videos", "en")).toBe("/en/saved-videos");
  expect(localizedHref("/saved-videos", "ja")).toBe("/jp/saved-videos");
  expect(localizedHref("/auth/sign-in?next=%2Fsaved-videos", "ja")).toBe("/auth/sign-in?next=%2Fjp%2Fsaved-videos");
});
