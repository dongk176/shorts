import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import {
  USER_ONBOARDING_VERSION,
  userOnboardingSubmissionSchema,
} from "@/lib/user-onboarding";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import {
  ONBOARDING_WELCOME_CAMPAIGN_CODE,
  ONBOARDING_WELCOME_GRANT_SECONDS,
  ONBOARDING_WELCOME_GRANT_VALIDITY_DAYS,
  ONBOARDING_WELCOME_PRODUCT_CODE,
} from "@/lib/onboarding-welcome";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const rows = await getDb()`
      select 1
      from shorts_mvp.user_onboarding_profiles
      where user_id=${session.userId}
      limit 1
    `;
    return noStoreJson({
      required: !rows[0],
      version: USER_ONBOARDING_VERSION,
    });
  } catch (error) {
    const response = apiError(error, "온보딩 정보를 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request, "온보딩 요청");
    const input = userOnboardingSubmissionSchema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();

    await db.begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtextextended(${`onboarding-welcome:${session.userId}`},0)
        )
      `;
      await tx`
        insert into shorts_mvp.user_onboarding_profiles (
          user_id,request_id,occupation,occupation_other,usage_purposes,
          usage_purpose_other,onboarding_version
        ) values (
          ${session.userId},${input.requestId},${input.occupation},
          ${input.occupationOther},${input.usagePurposes},
          ${input.usagePurposeOther},${USER_ONBOARDING_VERSION}
        )
        on conflict (user_id) do nothing
      `;
      const profileRows = await tx`
        select request_id,completed_at
        from shorts_mvp.user_onboarding_profiles
        where user_id=${session.userId}
        limit 1
      `;
      const profile = profileRows[0] as {
        requestId: string;
        completedAt: Date;
      } | undefined;
      if (!profile || profile.requestId !== input.requestId) return;

      const eligibleRows = await tx`
        select 1
        from shorts_mvp.app_users account
        where account.id=${session.userId}
          and account.withdrawn_at is null
          and not (
            account.manual_service_access_until is not null
            and account.manual_service_access_until>clock_timestamp()
          )
          and not exists (
            select 1
            from shorts_mvp.billing_orders paid_order
            where paid_order.user_id=account.id
              and paid_order.status='succeeded'
              and paid_order.amount_krw>0
          )
          and not exists (
            select 1
            from shorts_mvp.user_subscriptions subscription
            where subscription.user_id=account.id
              and subscription.status in ('pending','trialing','active','past_due')
          )
        limit 1
      `;
      if (!eligibleRows[0]) return;

      await tx`
        insert into shorts_mvp.usage_grants (
          user_id,kind,product_code,total_seconds,credited_seconds,
          carried_seconds,reserved_seconds,consumed_seconds,
          valid_from,expires_at,status
        ) values (
          ${session.userId},'addon',${ONBOARDING_WELCOME_PRODUCT_CODE},
          ${ONBOARDING_WELCOME_GRANT_SECONDS},${ONBOARDING_WELCOME_GRANT_SECONDS},
          0,0,0,${profile.completedAt},
          ${profile.completedAt}
            + ${ONBOARDING_WELCOME_GRANT_VALIDITY_DAYS} * interval '1 day',
          'active'
        )
        on conflict do nothing
      `;
      const grantRows = await tx`
        select total_seconds,expires_at
        from shorts_mvp.usage_grants
        where user_id=${session.userId}
          and product_code=${ONBOARDING_WELCOME_PRODUCT_CODE}
        limit 1
      `;
      const grant = grantRows[0] as {
        totalSeconds: number;
        expiresAt: Date;
      } | undefined;
      if (!grant) return;

      await tx`
        insert into shorts_mvp.member_campaign_announcements (
          user_id,campaign_code,granted_seconds,valid_until
        ) values (
          ${session.userId},${ONBOARDING_WELCOME_CAMPAIGN_CODE},
          ${Number(grant.totalSeconds)},${grant.expiresAt}
        )
        on conflict (user_id,campaign_code) do nothing
      `;
    });

    return noStoreJson({ completed: true });
  } catch (error) {
    const response = apiError(error, "온보딩 응답을 저장하지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
