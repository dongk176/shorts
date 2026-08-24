import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { issueLoginWelcomeGrantIfEligible } from "./onboarding-welcome-grant";

const replayedMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202607280007_free_onboarding_welcome_grant.sql",
    import.meta.url,
  ),
  "utf8",
);
const runtimeFlagMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202607290002_admin_runtime_feature_flags.sql",
    import.meta.url,
  ),
  "utf8",
);

afterEach(() => {
  delete process.env.ONBOARDING_WELCOME_GRANT_ENABLED;
});

describe("login welcome grant", () => {
  it("issues one atomic grant-and-announcement statement by default", async () => {
    let statement = "";
    const db = vi.fn((strings: TemplateStringsArray) => {
      statement = strings.join("?");
      return Promise.resolve([{
        granted: true,
        announcementCount: 1,
      }]);
    }) as unknown as Sql;

    await expect(issueLoginWelcomeGrantIfEligible(db, "user-free"))
      .resolves.toBe(true);
    expect(db).toHaveBeenCalledOnce();
    expect(statement).toContain("paid_order.status='succeeded'");
    expect(statement).toContain(
      "subscription.status in ('pending','trialing','active','past_due')",
    );
    expect(statement).toContain(
      "from shorts_mvp.runtime_feature_flags feature_flag",
    );
    expect(statement).toContain("feature_flag.enabled=true");
    expect(statement).toContain("on conflict do nothing");
    expect(statement).toContain(
      "insert into shorts_mvp.member_campaign_announcements",
    );
  });

  it("does not query for a grant when explicitly disabled", async () => {
    process.env.ONBOARDING_WELCOME_GRANT_ENABLED = "false";
    const db = vi.fn() as unknown as Sql;

    await expect(issueLoginWelcomeGrantIfEligible(db, "user-free"))
      .resolves.toBe(false);
    expect(db).not.toHaveBeenCalled();
  });

  it("does not replay historical bulk grants during later DB migrations", () => {
    expect(replayedMigration).not.toContain("with eligible_accounts as");
    expect(replayedMigration).not.toContain(
      "insert into shorts_mvp.member_campaign_announcements",
    );
  });

  it("seeds the administrator switch without overwriting later choices", () => {
    expect(runtimeFlagMigration).toContain(
      "create table if not exists shorts_mvp.runtime_feature_flags",
    );
    expect(runtimeFlagMigration).toContain(
      "'login_welcome_grant'",
    );
    expect(runtimeFlagMigration).toContain(
      "on conflict (flag_key) do nothing",
    );
    expect(runtimeFlagMigration).not.toContain(
      "on conflict (flag_key) do update",
    );
    expect(runtimeFlagMigration).toContain(
      "alter table shorts_mvp.runtime_feature_flags enable row level security",
    );
    expect(runtimeFlagMigration).toContain(
      "revoke all on shorts_mvp.runtime_feature_flags from anon, authenticated",
    );
  });
});
