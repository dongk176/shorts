import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyticsSafePathname } from "@/lib/analytics-path";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("creator project public flow", () => {
  it("redacts bearer tokens from analytics paths", () => {
    expect(analyticsSafePathname("/creator-project/secret-token"))
      .toBe("/creator-project/[token]");
    expect(analyticsSafePathname("/projects/123")).toBe("/projects/123");
  });

  it("keeps the page private, read-only, and returns signup to the workspace", () => {
    const page = source("./creator-project/[token]/page.tsx");
    const client = source("./creator-project/[token]/creator-project-client.tsx");
    const languageSelector = source("../components/language-selector.tsx");

    expect(page).toContain('robots: { index: false, follow: false }');
    expect(page).toContain('referrer: "no-referrer"');
    expect(client).toContain('next="/#workspace"');
    expect(client).toContain("쇼츠 더 만들어보기");
    expect(client).toContain("지금 가입하면 20분을 무료로 체험할 수 있습니다");
    expect(client).not.toContain("다운로드");
    expect(client).not.toContain("편집하기");
    expect(languageSelector).toContain('if (/^\\/creator-project(?:\\/|$)/.test(pathname)) return null');
  });

  it("binds media access to both the share token and the requested short", () => {
    const data = source("../lib/creator-project-shares.ts");
    const route = source("./api/creator-project/[token]/shorts/[shortId]/access/route.ts");

    expect(data).toContain("share.token_hash=${creatorProjectShareTokenHash(token)}");
    expect(data).toContain("short.id=${shortId}");
    expect(data).toContain("share.expires_at>clock_timestamp()");
    expect(route).toContain("Math.min(");
    expect(route).toContain("media.shareExpiresAt.getTime()");
  });

  it("keeps share data service-role-only and stores conversion attribution", () => {
    const migration = source("../../supabase/migrations/202608140002_creator_project_shares.sql");
    const session = source("../lib/session.ts");

    expect(migration).toContain("creator_project_share_visitors");
    expect(migration).toContain("unique (share_id,mvp_session_id)");
    expect(migration).toContain("creator_share_visitors_converted_user_idx");
    expect(migration).toContain("revoke all on shorts_mvp.creator_project_shares from anon, authenticated");
    expect(session).toContain("order by visitor.last_cta_clicked_at desc");
    expect(session).toContain("CREATOR_PROJECT_SHARE_ATTRIBUTION_DAYS");
    expect(session).toContain("if (newlyCreated)");
    expect(session).toContain("visitor.converted_at is null");
  });
});
