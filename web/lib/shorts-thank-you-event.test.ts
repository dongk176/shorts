import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  claimShortsThankYouEventWelcome,
  issueShortsThankYouEventGrantIfEligible,
} from "./shorts-thank-you-event";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607300012_shorts_10k_thank_you_event.sql",
    import.meta.url,
  ),
  "utf8",
);
const retirementMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202608010001_disable_shorts_10k_thank_you_event.sql",
    import.meta.url,
  ),
  "utf8",
);
const billingSource = readFileSync(
  new URL("./billing.ts", import.meta.url),
  "utf8",
);
const usageSource = readFileSync(
  new URL("./usage.ts", import.meta.url),
  "utf8",
);

afterEach(() => {
  delete process.env.SHORTS_10K_EVENT_ENABLED;
});

describe("shorts 10k thank-you event", () => {
  it("claims one server-owned presentation and reports reward availability", async () => {
    process.env.SHORTS_10K_EVENT_ENABLED = "true";
    let statement = "";
    const db = vi.fn((strings: TemplateStringsArray) => {
      statement = strings.join("?");
      return Promise.resolve([{
        enabled: true,
        welcomeClaimed: true,
        rewardAvailable: true,
      }]);
    }) as unknown as Sql;

    await expect(claimShortsThankYouEventWelcome(db, "user-a"))
      .resolves.toEqual({
        enabled: true,
        welcomeClaimed: true,
        rewardAvailable: true,
      });
    expect(statement).toContain(
      "insert into shorts_mvp.member_campaign_presentations",
    );
    expect(statement).toContain("on conflict (user_id,campaign_code) do nothing");
  });

  it("issues 50 minutes without a participant-count cap", async () => {
    process.env.SHORTS_10K_EVENT_ENABLED = "true";
    let statement = "";
    const expiresAt = new Date("2026-10-28T00:00:00.000Z");
    const db = vi.fn((strings: TemplateStringsArray) => {
      statement = strings.join("?");
      return Promise.resolve([{
        totalSeconds: 3_000,
        expiresAt,
      }]);
    }) as unknown as Sql;

    await expect(issueShortsThankYouEventGrantIfEligible(db, "user-a"))
      .resolves.toEqual({
        granted: true,
        grantedSeconds: 3_000,
        validUntil: expiresAt.toISOString(),
      });
    expect(statement).toContain("insert into shorts_mvp.usage_grants");
    expect(statement).toContain("from shorts_mvp.runtime_feature_flags");
    expect(statement).toContain("on conflict do nothing");
    expect(statement).not.toMatch(/\b200\b|limit\s+200|count\s*\(/i);
  });

  it("keeps the retired event off unless deployment explicitly opts in", async () => {
    const db = vi.fn() as unknown as Sql;

    await expect(issueShortsThankYouEventGrantIfEligible(db, "user-a"))
      .resolves.toMatchObject({ granted: false });
    await expect(claimShortsThankYouEventWelcome(db, "user-a"))
      .resolves.toMatchObject({ enabled: false });
    expect(db).not.toHaveBeenCalled();
  });

  it("keeps the database runtime flag off after the retirement migration", () => {
    expect(retirementMigration).toContain("'shorts_10k_thank_you_event'");
    expect(retirementMigration).toMatch(/enabled\s*=\s*false/i);
  });

  it("seeds runtime control and database one-account guards", () => {
    expect(migration).toContain("'shorts_10k_thank_you_event'");
    expect(migration).toContain("on conflict (flag_key) do nothing");
    expect(migration).toContain(
      "primary key (user_id,campaign_code)",
    );
    expect(migration).toContain(
      "usage_grants_one_shorts_10k_thank_you_per_user_idx",
    );
    expect(migration).not.toMatch(/limit\s+200|count\s*\([^)]*\)\s*<\s*200/i);
    expect(billingSource).toContain("SHORTS_THANK_YOU_EVENT_PRODUCT_CODE");
    expect(usageSource).toContain("SHORTS_THANK_YOU_EVENT_PRODUCT_CODE");
    expect(migration).toContain("'shorts_10k_thank_you_50min_v1'");
  });
});
