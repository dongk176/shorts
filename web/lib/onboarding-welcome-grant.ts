import type { Sql, TransactionSql } from "postgres";
import {
  LOGIN_WELCOME_GRANT_FLAG_KEY,
  ONBOARDING_WELCOME_CAMPAIGN_CODE,
  ONBOARDING_WELCOME_GRANT_SECONDS,
  ONBOARDING_WELCOME_GRANT_VALIDITY_DAYS,
  ONBOARDING_WELCOME_PRODUCT_CODE,
  onboardingWelcomeGrantEnabled,
} from "@/lib/onboarding-welcome";

export async function issueLoginWelcomeGrantIfEligible(
  db: Sql | TransactionSql,
  userId: string,
) {
  if (!onboardingWelcomeGrantEnabled()) return false;

  const rows = await db`
    with eligible_account as (
      select account.id
      from shorts_mvp.app_users account
      where account.id=${userId}
        and account.withdrawn_at is null
        and exists (
          select 1
          from shorts_mvp.runtime_feature_flags feature_flag
          where feature_flag.flag_key=${LOGIN_WELCOME_GRANT_FLAG_KEY}
            and feature_flag.enabled=true
        )
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
    ), inserted_grant as (
      insert into shorts_mvp.usage_grants (
        user_id,kind,product_code,total_seconds,credited_seconds,
        carried_seconds,reserved_seconds,consumed_seconds,
        valid_from,expires_at,status
      )
      select
        eligible.id,'addon',${ONBOARDING_WELCOME_PRODUCT_CODE},
        ${ONBOARDING_WELCOME_GRANT_SECONDS},${ONBOARDING_WELCOME_GRANT_SECONDS},
        0,0,0,statement_timestamp(),
        statement_timestamp()
          + ${ONBOARDING_WELCOME_GRANT_VALIDITY_DAYS} * interval '1 day',
        'active'
      from eligible_account eligible
      on conflict do nothing
      returning user_id,total_seconds,expires_at
    ), inserted_announcement as (
      insert into shorts_mvp.member_campaign_announcements (
        user_id,campaign_code,granted_seconds,valid_until
      )
      select
        grant_row.user_id,${ONBOARDING_WELCOME_CAMPAIGN_CODE},
        grant_row.total_seconds,grant_row.expires_at
      from inserted_grant grant_row
      on conflict (user_id,campaign_code) do nothing
      returning user_id
    )
    select
      exists(select 1 from inserted_grant) as granted,
      (select count(*) from inserted_announcement)::integer
        as announcement_count
  `;
  return Boolean(rows[0]?.granted);
}
