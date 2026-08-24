import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  PARTNER_APPLICATION_MAX_PER_EMAIL_PER_DAY,
  PARTNER_APPLICATION_MAX_PER_IP_PER_DAY,
  partnerApplicationReferenceCode,
  partnerApplicationSubmissionSchema,
} from "@/lib/partner-application";
import { referralRateLimitHash } from "@/lib/referral-security";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { requireMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApplicationRow = {
  id: string;
  createdAt: Date | string;
};

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function applicationResponse(row: ApplicationRow, existing: boolean) {
  const response = NextResponse.json({
    submitted: true,
    alreadySubmitted: existing,
    applicationId: row.id,
    referenceCode: partnerApplicationReferenceCode(row.id),
    createdAt: row.createdAt,
  }, { status: existing ? 200 : 201 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginJsonRequest(request);
    const [input, session] = await Promise.all([
      request.json().then((value) => partnerApplicationSubmissionSchema.parse(value)),
      requireMvpSession(),
    ]);
    const sourceIpHash = referralRateLimitHash(`partner-application-ip:${clientAddress(request)}`);
    const emailHash = referralRateLimitHash(`partner-application-email:${input.email}`);
    const userAgent = request.headers.get("user-agent")?.trim().slice(0, 512) || null;
    const db = getDb();

    const result = await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(hashtextextended(${emailHash},0)),
          pg_advisory_xact_lock(hashtextextended(${sourceIpHash},0))
      `;

      const retriedRows = await tx`
        select id,created_at
        from shorts_mvp.partner_applications
        where request_id=${input.requestId}
          and applicant_email=${input.email}
        limit 1
      `;
      if (retriedRows[0]) {
        return { row: retriedRows[0] as ApplicationRow, existing: true, rateLimit: null };
      }

      await tx`
        delete from shorts_mvp.partner_application_submission_attempts
        where attempted_at < clock_timestamp() - interval '2 days'
      `;
      const attemptRows = await tx`
        insert into shorts_mvp.partner_application_submission_attempts (
          email_hash,source_ip_hash
        ) values (${emailHash},${sourceIpHash})
        returning id
      `;
      const attemptId = attemptRows[0].id;
      const recentRows = await tx`
        select
          count(*) filter (where email_hash=${emailHash})::integer as email_count,
          count(*) filter (where source_ip_hash=${sourceIpHash})::integer as ip_count
        from shorts_mvp.partner_application_submission_attempts
        where attempted_at >= clock_timestamp() - interval '1 day'
      `;
      if (Number(recentRows[0]?.emailCount || 0) > PARTNER_APPLICATION_MAX_PER_EMAIL_PER_DAY) {
        return { row: null, existing: false, rateLimit: "email" as const };
      }
      if (Number(recentRows[0]?.ipCount || 0) > PARTNER_APPLICATION_MAX_PER_IP_PER_DAY) {
        return { row: null, existing: false, rateLimit: "ip" as const };
      }

      const activeRows = await tx`
        select id,created_at
        from shorts_mvp.partner_applications
        where lower(applicant_email)=lower(${input.email})
          and status in ('new','reviewing','contacted','accepted')
        order by created_at desc
        limit 1
      `;
      if (activeRows[0]) {
        await tx`
          update shorts_mvp.partner_application_submission_attempts
          set accepted=true where id=${attemptId}
        `;
        return { row: activeRows[0] as ApplicationRow, existing: true, rateLimit: null };
      }

      const insertedRows = await tx`
        insert into shorts_mvp.partner_applications (
          request_id,mvp_session_id,user_id,display_name,applicant_email,phone,
          channel_types,channel_url,audience_size,promotion_plan,income_goal,
          disclosure_agreed,anti_abuse_agreed,privacy_agreed,consent_version,
          source_ip_hash,user_agent
        ) values (
          ${input.requestId},${session.id},${session.userId},${input.displayName},
          ${input.email},${input.phone},${input.channelTypes},${input.channelUrl},
          ${input.audienceSize},${input.promotionPlan},${input.incomeGoal},
          ${input.disclosureAgreed},${input.antiAbuseAgreed},${input.privacyAgreed},
          ${input.consentVersion},${sourceIpHash},${userAgent}
        )
        returning id,created_at
      `;
      await tx`
        update shorts_mvp.partner_application_submission_attempts
        set accepted=true where id=${attemptId}
      `;
      return { row: insertedRows[0] as ApplicationRow, existing: false, rateLimit: null };
    });

    if (result.rateLimit === "email") {
      throw new HttpError(
        429,
        "같은 이메일로 접수된 신청이 많습니다. 하루 뒤 다시 시도해 주세요.",
        "PARTNER_APPLICATION_EMAIL_RATE_LIMIT",
        24 * 60 * 60,
      );
    }
    if (result.rateLimit === "ip") {
      throw new HttpError(
        429,
        "접수 요청이 너무 많습니다. 하루 뒤 다시 시도해 주세요.",
        "PARTNER_APPLICATION_IP_RATE_LIMIT",
        24 * 60 * 60,
      );
    }
    if (!result.row) throw new Error("파트너 신청 저장 결과가 없습니다.");
    return applicationResponse(result.row, result.existing);
  } catch (error) {
    return apiError(error, "파트너 신청을 접수하지 못했습니다.");
  }
}
