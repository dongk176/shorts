import type { Sql, TransactionSql } from "postgres";

export const SHORTS_THANK_YOU_EVENT_FLAG_KEY =
  "shorts_10k_thank_you_event";
export const SHORTS_THANK_YOU_EVENT_CAMPAIGN_CODE =
  "shorts_10k_thank_you_event_v1";
export const SHORTS_THANK_YOU_EVENT_PRODUCT_CODE =
  "shorts_10k_thank_you_50min_v1";
export const SHORTS_THANK_YOU_EVENT_GRANT_SECONDS = 50 * 60;
export const SHORTS_THANK_YOU_EVENT_VALIDITY_DAYS = 90;

export function shortsThankYouEventEnabled() {
  return process.env.SHORTS_10K_EVENT_ENABLED?.trim().toLowerCase() === "true";
}

export type ShortsThankYouEventClaim = {
  enabled: boolean;
  welcomeClaimed: boolean;
  rewardAvailable: boolean;
};

export async function claimShortsThankYouEventWelcome(
  db: Sql | TransactionSql,
  userId: string,
): Promise<ShortsThankYouEventClaim> {
  if (!shortsThankYouEventEnabled()) {
    return {
      enabled: false,
      welcomeClaimed: false,
      rewardAvailable: false,
    };
  }

  const rows = await db`
    with enabled_campaign as (
      select 1
      from shorts_mvp.runtime_feature_flags feature_flag
      join shorts_mvp.app_users account on account.id=${userId}
      where feature_flag.flag_key=${SHORTS_THANK_YOU_EVENT_FLAG_KEY}
        and feature_flag.enabled=true
        and account.withdrawn_at is null
    ), inserted_presentation as (
      insert into shorts_mvp.member_campaign_presentations (
        user_id,campaign_code
      )
      select
        ${userId},${SHORTS_THANK_YOU_EVENT_CAMPAIGN_CODE}
      from enabled_campaign
      on conflict (user_id,campaign_code) do nothing
      returning user_id
    )
    select
      exists(select 1 from enabled_campaign) as enabled,
      exists(select 1 from inserted_presentation) as welcome_claimed,
      exists(select 1 from enabled_campaign)
        and not exists (
          select 1
          from shorts_mvp.usage_grants event_grant
          where event_grant.user_id=${userId}
            and event_grant.product_code=${SHORTS_THANK_YOU_EVENT_PRODUCT_CODE}
        ) as reward_available
  `;
  return {
    enabled: Boolean(rows[0]?.enabled),
    welcomeClaimed: Boolean(rows[0]?.welcomeClaimed),
    rewardAvailable: Boolean(rows[0]?.rewardAvailable),
  };
}

export type ShortsThankYouEventGrant = {
  granted: boolean;
  grantedSeconds: number;
  validUntil: string | null;
};

export async function issueShortsThankYouEventGrantIfEligible(
  db: Sql | TransactionSql,
  userId: string,
): Promise<ShortsThankYouEventGrant> {
  if (!shortsThankYouEventEnabled()) {
    return {
      granted: false,
      grantedSeconds: 0,
      validUntil: null,
    };
  }

  const rows = await db`
    insert into shorts_mvp.usage_grants (
      user_id,kind,product_code,total_seconds,credited_seconds,
      carried_seconds,reserved_seconds,consumed_seconds,
      valid_from,expires_at,status
    )
    select
      account.id,'addon',${SHORTS_THANK_YOU_EVENT_PRODUCT_CODE},
      ${SHORTS_THANK_YOU_EVENT_GRANT_SECONDS},
      ${SHORTS_THANK_YOU_EVENT_GRANT_SECONDS},
      0,0,0,statement_timestamp(),
      statement_timestamp()
        + ${SHORTS_THANK_YOU_EVENT_VALIDITY_DAYS} * interval '1 day',
      'active'
    from shorts_mvp.app_users account
    where account.id=${userId}
      and account.withdrawn_at is null
      and exists (
        select 1
        from shorts_mvp.runtime_feature_flags feature_flag
        where feature_flag.flag_key=${SHORTS_THANK_YOU_EVENT_FLAG_KEY}
          and feature_flag.enabled=true
      )
    on conflict do nothing
    returning total_seconds,expires_at
  `;
  const row = rows[0] as {
    totalSeconds: number;
    expiresAt: Date;
  } | undefined;
  return {
    granted: Boolean(row),
    grantedSeconds: row ? Number(row.totalSeconds) : 0,
    validUntil: row ? row.expiresAt.toISOString() : null,
  };
}
