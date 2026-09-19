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
