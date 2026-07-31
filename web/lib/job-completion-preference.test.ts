import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emailPreferenceDecisionSchema,
  jobCompletionEmailDecisionSchema,
  notificationEmailSchema,
} from "./job-completion-preference";

const onboardingOverlay = readFileSync(
  new URL("../components/user-onboarding-overlay.tsx", import.meta.url),
  "utf8",
);
const preferenceRoute = readFileSync(
  new URL(
    "../app/api/account/completion-email-preference/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const notificationEmailMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202607300010_notification_email_overrides.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("job completion email preference", () => {
  it("accepts only explicit user decisions and normalizes email addresses", () => {
    expect(jobCompletionEmailDecisionSchema.parse({ status: "enabled" })).toEqual({
      status: "enabled",
    });
    expect(jobCompletionEmailDecisionSchema.parse({ status: "declined" })).toEqual({
      status: "declined",
    });
    expect(() => jobCompletionEmailDecisionSchema.parse({ status: "not_asked" }))
      .toThrow();
    expect(emailPreferenceDecisionSchema.parse({
      status: "enabled",
      marketingStatus: "declined",
      email: " Alerts@Example.com ",
    })).toEqual({
      status: "enabled",
      marketingStatus: "declined",
      email: "alerts@example.com",
    });
    expect(notificationEmailSchema.parse("Alerts@Example.com"))
      .toBe("alerts@example.com");
  });

  it("keeps marketing consent unselected by default", () => {
    expect(onboardingOverlay).toContain(
      "const [marketingEmailOptIn, setMarketingEmailOptIn] = useState(false);",
    );
    expect(onboardingOverlay).not.toContain(
      "const [marketingEmailOptIn, setMarketingEmailOptIn] = useState(true);",
    );
  });

  it("limits the prompt and mutations to onboarding v2 with configured email infrastructure", () => {
    expect(preferenceRoute).toContain("jobCompletionEmailPreferenceAvailable");
    expect(preferenceRoute).toContain("Number(account.onboardingVersion) === 2");
    expect(preferenceRoute).toContain("Number(accountRows[0].onboardingVersion) !== 2");
  });

  it("stops unsent mail immediately after transactional email is declined", () => {
    expect(preferenceRoute).toContain(
      "status in ('waiting','pending')",
    );
    expect(notificationEmailMigration).toContain(
      "preference.completion_email_status='enabled'",
    );
  });
});
