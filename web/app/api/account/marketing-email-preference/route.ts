import { NextResponse } from "next/server";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  MARKETING_EMAIL_CONSENT_VERSION,
  marketingEmailDecisionSchema,
  marketingEmailPreferenceAvailable,
  type MarketingEmailPreferenceStatus,
} from "@/lib/marketing-email-preference";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const available = marketingEmailPreferenceAvailable();
    const rows = await getDb()`
      select account.email,preference.marketing_email,
             preference.marketing_email_status,
             onboarding.onboarding_version,
             (
               select count(*)::integer
               from shorts_mvp.video_jobs job
               where job.user_id=account.id
                 and not job.is_example
                 and job.status='completed'
             ) as completed_job_count
      from shorts_mvp.app_users account
      left join shorts_mvp.user_email_notification_preferences preference
        on preference.user_id=account.id
      left join shorts_mvp.user_onboarding_profiles onboarding
        on onboarding.user_id=account.id
      where account.id=${session.userId}
        and account.withdrawn_at is null
      limit 1
    `;
    const account = rows[0];
    if (!account) throw new HttpError(404, "회원 정보를 찾을 수 없습니다.");

    const status: MarketingEmailPreferenceStatus =
      account.marketingEmailStatus === "enabled"
      || account.marketingEmailStatus === "declined"
        ? account.marketingEmailStatus
        : "not_asked";
    const email = String(account.marketingEmail || account.email || "").trim() || null;
    const completedJobCount = Number(account.completedJobCount || 0);
    const eligible = Number(account.onboardingVersion) === 2;

    return noStoreJson({
      available,
      eligible,
      status,
      email,
      promptDue: available
        && eligible
        && status === "not_asked"
        && completedJobCount >= 1
        && Boolean(email),
      completedJobCount,
    });
  } catch (error) {
    const response = apiError(error, "광고성 이메일 설정을 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request, "광고성 이메일 수신 설정 요청");
    if (!marketingEmailPreferenceAvailable()) {
      throw new HttpError(
        503,
        "이메일 기능이 아직 준비되지 않았습니다.",
        "MARKETING_EMAIL_UNAVAILABLE",
      );
    }
    const input = marketingEmailDecisionSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const result = await getDb().begin(async (tx) => {
      const accountRows = await tx`
        select account.email,onboarding.onboarding_version,
               preference.marketing_email
        from shorts_mvp.app_users account
        left join shorts_mvp.user_onboarding_profiles onboarding
          on onboarding.user_id=account.id
        left join shorts_mvp.user_email_notification_preferences preference
          on preference.user_id=account.id
        where account.id=${session.userId}
          and account.withdrawn_at is null
        limit 1
        for update of account
      `;
      const account = accountRows[0];
      if (!account) throw new HttpError(404, "회원 정보를 찾을 수 없습니다.");
      if (Number(account.onboardingVersion) !== 2) {
        throw new HttpError(
          409,
          "이 설정은 최신 온보딩을 완료한 회원에게만 제공됩니다.",
          "ONBOARDING_V2_REQUIRED",
        );
      }

      const accountEmail = String(account.email || "").trim().toLowerCase();
      const existingMarketingEmail =
        String(account.marketingEmail || "").trim().toLowerCase();
      const selectedEmail = input.email
        || existingMarketingEmail
        || accountEmail;
      if (input.status === "enabled" && !selectedEmail) {
        throw new HttpError(
          409,
          "이메일 주소를 확인할 수 없습니다. 주소를 입력한 뒤 다시 시도해 주세요.",
          "ACCOUNT_EMAIL_REQUIRED",
        );
      }
      const marketingEmail = input.status === "enabled"
        && selectedEmail !== accountEmail
        ? selectedEmail
        : null;

      const preferenceRows = await tx`
        insert into shorts_mvp.user_email_notification_preferences (
          user_id,completion_email_status,decided_at,
          marketing_email_status,marketing_decided_at,
          marketing_email,marketing_decision_version
        ) values (
          ${session.userId},'enabled',clock_timestamp(),
          ${input.status},clock_timestamp(),
          ${marketingEmail},${MARKETING_EMAIL_CONSENT_VERSION}
        )
        on conflict (user_id) do update
        set marketing_email_status=excluded.marketing_email_status,
            marketing_decided_at=clock_timestamp(),
            marketing_email=excluded.marketing_email,
            marketing_decision_version=excluded.marketing_decision_version
        returning marketing_email_status
      `;

      await tx`
        delete from shorts_mvp.email_preference_prompt_snoozes
        where user_id=${session.userId}
      `;

      return {
        available: true,
        eligible: true,
        status: preferenceRows[0].marketingEmailStatus,
        email: selectedEmail || null,
        promptDue: false,
        completedJobCount: 0,
      };
    });

    return noStoreJson(result);
  } catch (error) {
    const response = apiError(error, "광고성 이메일 설정을 저장하지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
