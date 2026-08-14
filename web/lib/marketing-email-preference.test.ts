import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MARKETING_EMAIL_CONSENT_VERSION,
  marketingEmailDecisionSchema,
  marketingEmailSchema,
} from "./marketing-email-preference";

const marketingOverlay = readFileSync(
  new URL("../components/marketing-email-preference-overlay.tsx", import.meta.url),
  "utf8",
);
const onboardingOverlay = readFileSync(
  new URL("../components/user-onboarding-overlay.tsx", import.meta.url),
  "utf8",
);
const completionEmailMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202608140001_transactional_completion_emails.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("marketing email preference", () => {
  it("accepts only an explicit decision and normalizes an optional address", () => {
    expect(marketingEmailDecisionSchema.parse({
      status: "enabled",
      email: " Alerts@Example.com ",
    })).toEqual({
      status: "enabled",
      email: "alerts@example.com",
    });
    expect(marketingEmailDecisionSchema.parse({ status: "declined" }))
      .toEqual({ status: "declined" });
    expect(() => marketingEmailDecisionSchema.parse({ status: "not_asked" }))
      .toThrow();
    expect(marketingEmailSchema.parse("Alerts@Example.com"))
      .toBe("alerts@example.com");
    expect(MARKETING_EMAIL_CONSENT_VERSION).toBe("2026-08-14-v2");
  });

  it("uses a standalone advertising-consent overlay with explicit choices", () => {
    expect(marketingOverlay).toContain("할인·이벤트 소식을 받아보세요");
    expect(marketingOverlay).toContain("받지 않을게요");
    expect(marketingOverlay).toContain("광고성 이메일 수신에 동의하기");
    expect(marketingOverlay).toContain(
      "프로젝트 완료 알림은 광고 수신 여부와 관계없이",
    );
    expect(marketingOverlay).not.toContain("나중에");
    expect(onboardingOverlay).not.toContain("완성되면 바로 알려드릴게요");
    expect(onboardingOverlay).not.toContain("completion-email-preference");
  });

  it("queues every real project and claims with the account email", () => {
    expect(completionEmailMigration).toContain(
      "create trigger video_jobs_queue_all_completion_email",
    );
    expect(completionEmailMigration).toContain("new.user_id is null or new.is_example");
    expect(completionEmailMigration).toContain("btrim(account.email)");
    expect(completionEmailMigration).not.toContain(
      "preference.completion_email_status='enabled'",
    );
    expect(completionEmailMigration).toContain(
      "Historical\n-- completed projects are intentionally excluded",
    );
  });
});
