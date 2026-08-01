import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  emailPreferenceDecisionSchema,
  FIRST_JOB_CREATED_EMAIL_PREFERENCE_EVENT,
  jobCompletionEmailDecisionSchema,
  notificationEmailSchema,
} from "./job-completion-preference";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202607300007_user_completion_email_preferences.sql",
    import.meta.url,
  ),
  "utf8",
);
const onboardingOverlay = readFileSync(
  new URL("../components/user-onboarding-overlay.tsx", import.meta.url),
  "utf8",
);
const shortsApp = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const marketingMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202607300008_marketing_email_preferences.sql",
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
  it("accepts only explicit user decisions", () => {
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
    expect(() => notificationEmailSchema.parse("not-an-email")).toThrow();
  });

  it("automatically queues future non-example jobs for opted-in users", () => {
    expect(migration).toContain(
      "from shorts_mvp.job_completion_email_notifications notification",
    );
    expect(migration).toContain("queue_opted_in_job_completion_email");
    expect(migration).toContain("after insert on shorts_mvp.video_jobs");
    expect(migration).toContain("completion_email_status='enabled'");
    expect(migration).toContain("this table is not marketing consent");
  });

  it("uses a clear benefit prompt with a persistent decline action", () => {
    expect(onboardingOverlay).toContain("영상 처리는 보통 5~10분 정도 걸려요");
    expect(onboardingOverlay).toContain("동의하고 이메일 알림 받기");
    expect(onboardingOverlay).toContain(
      "(선택) 광고성 정보 이메일 수신에 동의해요",
    );
    expect(onboardingOverlay).toContain(
      "const [marketingEmailOptIn, setMarketingEmailOptIn] = useState(true);",
    );
    expect(onboardingOverlay).toContain("나중에");
    expect(onboardingOverlay).toContain("completeQueueStage");
    expect(onboardingOverlay).toContain("queueActive");
    expect(onboardingOverlay).toContain('"declined"');
  });

  it("opens the preference prompt only after the first job is created", () => {
    expect(FIRST_JOB_CREATED_EMAIL_PREFERENCE_EVENT).toBe(
      "easycut:first-job-created-email-preference",
    );
    expect(shortsApp).toContain("isFirstJob: boolean");
    expect(shortsApp).toContain("if (value.isFirstJob)");
    expect(shortsApp).toContain("promptFirstJobEmailPreference");
    expect(onboardingOverlay).toContain(
      "window.addEventListener(\n      FIRST_JOB_CREATED_EMAIL_PREFERENCE_EVENT",
    );
    expect(onboardingOverlay).not.toContain(
      "else if (!await showCompletionEmailPrompt())",
    );
    expect(onboardingOverlay).not.toContain(
      "if (!await showCompletionEmailPrompt()) finishOverlay();",
    );
  });

  it("stores marketing consent separately with an audit timestamp", () => {
    expect(marketingMigration).toContain("marketing_email_status");
    expect(marketingMigration).toContain("marketing_decided_at");
    expect(marketingMigration).toContain("advertising event and promotional emails");
  });

  it("sends to an edited notification address without changing the login email", () => {
    expect(notificationEmailMigration).toContain("notification_email");
    expect(notificationEmailMigration).toContain(
      "coalesce(\n           nullif(btrim(preference.notification_email),'')",
    );
    expect(onboardingOverlay).toContain("편집");
    expect(onboardingOverlay).toContain("이메일 수신 주소");
  });
});
