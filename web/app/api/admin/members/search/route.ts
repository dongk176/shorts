import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { ADMIN_USAGE_GRANT_PRODUCT_CODE } from "@/lib/admin-usage-grant";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { ONBOARDING_WELCOME_PRODUCT_CODE } from "@/lib/onboarding-welcome";
import { SHORTS_THANK_YOU_EVENT_PRODUCT_CODE } from "@/lib/shorts-thank-you-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminUser();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || "";
    if (query.length < 2) {
      return NextResponse.json({ results: [] });
    }
    const normalizedQuery = query.toLocaleLowerCase("ko-KR");
    const rows = await getDb()`
      select
        account.id,account.email,account.display_name,
        coalesce(current_usage.total_seconds,0)::bigint as usage_limit_seconds,
        coalesce(current_usage.consumed_seconds,0)::bigint as usage_consumed_seconds,
        coalesce(current_usage.reserved_seconds,0)::bigint as usage_reserved_seconds
      from shorts_mvp.app_users account
      left join lateral (
        select
          coalesce(sum(grant_row.total_seconds),0)::bigint as total_seconds,
          coalesce(sum(grant_row.consumed_seconds),0)::bigint as consumed_seconds,
          coalesce(sum(grant_row.reserved_seconds),0)::bigint as reserved_seconds
        from shorts_mvp.usage_grants grant_row
        where grant_row.user_id=account.id
          and grant_row.status='active'
          and grant_row.valid_from<=clock_timestamp()
          and grant_row.expires_at>clock_timestamp()
          and (
            (
              grant_row.kind='base'
              and exists (
                select 1
                from shorts_mvp.user_subscriptions active_subscription
                where active_subscription.id=grant_row.subscription_id
                  and active_subscription.status='active'
                  and active_subscription.current_period_start<=clock_timestamp()
                  and active_subscription.current_period_end>clock_timestamp()
              )
            )
            or (
              grant_row.kind='addon'
              and (
                grant_row.product_code in (
                  ${ONBOARDING_WELCOME_PRODUCT_CODE},
                  ${SHORTS_THANK_YOU_EVENT_PRODUCT_CODE},
                  ${ADMIN_USAGE_GRANT_PRODUCT_CODE}
                )
                or account.manual_service_access_until>clock_timestamp()
                or exists (
                  select 1
                  from shorts_mvp.user_subscriptions active_subscription
                  where active_subscription.user_id=account.id
                    and active_subscription.status='active'
                    and active_subscription.current_period_start<=clock_timestamp()
                    and active_subscription.current_period_end>clock_timestamp()
                )
              )
            )
          )
      ) current_usage on true
      where account.withdrawn_at is null
        and (
          position(${normalizedQuery} in lower(coalesce(account.email,'')))>0
          or position(${normalizedQuery} in lower(coalesce(account.display_name,'')))>0
          or account.id::text=${query}
        )
      order by
        case
          when lower(coalesce(account.email,''))=${normalizedQuery} then 0
          when lower(coalesce(account.display_name,''))=${normalizedQuery} then 1
          when lower(coalesce(account.email,'')) like ${`${normalizedQuery}%`} then 2
          else 3
        end,
        account.created_at desc
      limit 20
    `;
    const results = rows.map((row) => {
      const limitSeconds = Number(row.usageLimitSeconds || 0);
      const consumedSeconds = Number(row.usageConsumedSeconds || 0);
      const reservedSeconds = Number(row.usageReservedSeconds || 0);
      return {
        id: row.id,
        email: row.email || "",
        displayName: row.displayName || null,
        usageRemainingSeconds: Math.max(
          0,
          limitSeconds - consumedSeconds - reservedSeconds,
        ),
      };
    });
    const response = NextResponse.json({ results });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return apiError(error, "회원을 검색하지 못했습니다.");
  }
}
