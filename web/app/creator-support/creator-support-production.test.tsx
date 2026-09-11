import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { SocialLoginButtons } from "@/components/social-login-buttons";
import CreatorSupportPage from "./page";
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("./creator-support-flow", () => ({ CreatorSupportFlow: () => null }));
afterEach(() => vi.unstubAllEnvs());
it("always uses real login even when obsolete preview flags and query parameters are supplied", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("CREATOR_SUPPORT_MOCK_PREVIEW", "1");
  const result = await CreatorSupportPage({ searchParams: Promise.resolve({ step: "account", mockPreview: "1", auth_error: "AUTH_START_FAILED" }) });
  expect(result.props).not.toHaveProperty("mockPreview");
  expect(result.props.initialAuthError).toContain("로그인을 시작하지 못했어요");
});
it("both provider links return to the creator account step", () => {
  const html = renderToStaticMarkup(<SocialLoginButtons next="/creator-support?step=account" />);
  expect(html).toContain("/auth/sign-in?provider=google"); expect(html).toContain("/auth/sign-in?provider=kakao");
  expect(html.match(/next=%2Fcreator-support%3Fstep%3Daccount/g)).toHaveLength(2);
  expect(html).not.toContain("<button");
});
