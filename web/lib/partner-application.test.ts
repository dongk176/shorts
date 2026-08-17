import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PARTNER_APPLICATION_CONSENT_VERSION,
  partnerApplicationReferenceCode,
  partnerApplicationSubmissionSchema,
} from "./partner-application";

const validApplication = {
  requestId: "da3f5f2e-d7e2-4f31-826f-1e9455d7a83b",
  displayName: "쇼츠 연구소",
  email: "Partner@Example.com",
  phone: "010-1234-5678",
  channelTypes: ["youtube", "blog"],
  channelUrl: "https://example.com/channel",
  audienceSize: "1000_5000",
  promotionPlan: "실제 이지컷 사용 과정을 유튜브와 블로그 콘텐츠로 소개하겠습니다.",
  incomeGoal: "over_300",
  disclosureAgreed: true,
  antiAbuseAgreed: true,
  privacyAgreed: true,
  consentVersion: PARTNER_APPLICATION_CONSENT_VERSION,
} as const;

describe("partner application", () => {
  it("normalizes the contact fields while preserving the application details", () => {
    const parsed = partnerApplicationSubmissionSchema.parse(validApplication);
    expect(parsed.email).toBe("partner@example.com");
    expect(parsed.phone).toBe("01012345678");
    expect(parsed.channelTypes).toEqual(["youtube", "blog"]);
    expect(partnerApplicationReferenceCode(validApplication.requestId)).toBe("PA-DA3F5F2E");
  });

  it("requires secure channel URLs and every explicit consent", () => {
    expect(partnerApplicationSubmissionSchema.safeParse({
      ...validApplication,
      channelUrl: "http://example.com/channel",
    }).success).toBe(false);
    expect(partnerApplicationSubmissionSchema.safeParse({
      ...validApplication,
      privacyAgreed: false,
    }).success).toBe(false);
    expect(partnerApplicationSubmissionSchema.safeParse({
      ...validApplication,
      phone: "() -- 12",
    }).success).toBe(false);
  });

  it("rejects unsupported choices and underspecified promotion plans", () => {
    expect(partnerApplicationSubmissionSchema.safeParse({
      ...validApplication,
      channelTypes: ["unsupported"],
    }).success).toBe(false);
    expect(partnerApplicationSubmissionSchema.safeParse({
      ...validApplication,
      promotionPlan: "짧은 설명",
    }).success).toBe(false);
  });

  it("keeps the public endpoint same-origin, idempotent and rate limited", () => {
    const routeSource = readFileSync(
      new URL("../app/api/partner/applications/route.ts", import.meta.url),
      "utf8",
    );
    expect(routeSource).toContain("assertSameOriginJsonRequest(request)");
    expect(routeSource).toContain("where request_id=${input.requestId}");
    expect(routeSource).toContain("PARTNER_APPLICATION_MAX_PER_EMAIL_PER_DAY");
    expect(routeSource).toContain("PARTNER_APPLICATION_MAX_PER_IP_PER_DAY");
    expect(routeSource).not.toContain("source_ip,");
  });

  it("keeps contact data behind server-only database access", () => {
    const migrationSource = readFileSync(
      new URL("../../supabase/migrations/202608170001_partner_applications.sql", import.meta.url),
      "utf8",
    );
    expect(migrationSource).toContain("enable row level security");
    expect(migrationSource).toContain("revoke all on table shorts_mvp.partner_applications from anon, authenticated");
    expect(migrationSource).toContain("partner_applications_one_active_email_idx");
    expect(migrationSource).toContain("partner_application_submission_attempts");
    expect(migrationSource).toContain("source_ip_hash");
  });

  it("limits application review and status changes to administrators", () => {
    const loaderSource = readFileSync(
      new URL("./admin-partner-applications.ts", import.meta.url),
      "utf8",
    );
    const actionSource = readFileSync(
      new URL("../app/admin/easycutcutcutcutcutcut/partner-application-actions.ts", import.meta.url),
      "utf8",
    );
    expect(loaderSource).toContain('import "server-only"');
    expect(actionSource).toContain("await requireAdminUser()");
    expect(actionSource).toContain("partner_application.updated");
    expect(actionSource).toContain("reviewed_by_user_id=${admin.id}");
  });
});
