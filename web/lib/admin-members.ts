import "server-only";

import { ADMIN_USAGE_GRANT_PRODUCT_CODE } from "@/lib/admin-usage-grant";
import { getDb } from "@/lib/db";
import { ONBOARDING_WELCOME_PRODUCT_CODE } from "@/lib/onboarding-welcome";
import { SHORTS_THANK_YOU_EVENT_PRODUCT_CODE } from "@/lib/shorts-thank-you-event";
import type { AdminMember } from "@/app/admin/easycutcutcutcutcutcut/admin-members-dashboard";

export const ADMIN_MEMBER_PAGE_SIZE = 100;

export type AdminMemberFilters = {
  query: string;
  memberType: string;
  memberPlan: string;
  memberActivity: string;
  memberReferrer: string;
};

export type AdminMemberPage = {
  members: AdminMember[];
  totalCount: number;
  hasMore: boolean;
  nextOffset: number;
};

function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : value
      ? new Date(String(value)).toISOString()
      : null;
}

function toAdminMember(row: Record<string, unknown>): AdminMember {
  const usageLimitSeconds = Number(row.usageLimitSeconds || 0);
  const usageConsumedSeconds = Number(row.usageConsumedSeconds || 0);
  const usageReservedSeconds = Number(row.usageReservedSeconds || 0);

  return {
    id: String(row.id),
    email: row.email ? String(row.email) : "-",
    displayName: row.displayName ? String(row.displayName) : null,
    createdAt: iso(row.createdAt)!,
    lastSignInAt: iso(row.lastSignInAt),
    subscriptionId: row.subscriptionId ? String(row.subscriptionId) : null,
    planCode: row.planCode ? String(row.planCode) : null,
    billingCycle: row.billingCycle ? String(row.billingCycle) : null,
    subscriptionStatus: row.subscriptionStatus ? String(row.subscriptionStatus) : null,
    currentPeriodStart: iso(row.currentPeriodStart),
    currentPeriodEnd: iso(row.currentPeriodEnd),
    nextChargeAt: iso(row.nextChargeAt),
    providerScheduleStatus: row.providerScheduleStatus ? String(row.providerScheduleStatus) : null,
    billingReviewStatus: row.billingReviewStatus ? String(row.billingReviewStatus) : null,
    billingReviewReason: row.billingReviewReason ? String(row.billingReviewReason) : null,
    paymentProvider: row.paymentProvider ? String(row.paymentProvider) : null,
    cardIssuer: row.issuerName ? String(row.issuerName) : null,
    cardNumberMasked: row.cardNumberMasked ? String(row.cardNumberMasked) : null,
    projectCount: Number(row.projectCount || 0),
    shortCount: Number(row.shortCount || 0),
    usageLimitSeconds,
    usageConsumedSeconds,
    usageReservedSeconds,
    usageRemainingSeconds: Math.max(
      0,
      usageLimitSeconds - usageConsumedSeconds - usageReservedSeconds,
    ),
    referralPartnerId: row.referralPartnerId ? String(row.referralPartnerId) : null,
    referralCreatorName: row.referralCreatorName ? String(row.referralCreatorName) : null,
    referralSlug: row.referralSlug ? String(row.referralSlug) : null,
  };
}

export async function loadAdminMembers({
  filters,
  offset = 0,
}: {
  filters: AdminMemberFilters;
  offset?: number;
}): Promise<AdminMemberPage> {
  const db = getDb();
  const normalizedQuery = filters.query.toLowerCase();
  const rows = await db`
    with filtered_users as materialized (
      select
        app_user.id,app_user.email,app_user.display_name,
        app_user.created_at,app_user.last_sign_in_at,
        app_user.manual_service_access_until,
        app_user.referral_partner_id,
        referral_partner.creator_name as referral_creator_name,
        referral_partner.slug as referral_slug,
        subscription.id as subscription_id,subscription.plan_code,
        subscription.billing_cycle,subscription.status as subscription_status,
        subscription.current_period_start,subscription.current_period_end,
        subscription.next_charge_at,subscription.provider_schedule_status,
        subscription.billing_review_status,subscription.billing_review_reason,
        subscription.payment_provider,subscription.payment_method_id,
        coalesce(app_user.last_sign_in_at,app_user.created_at) as sort_at,
        count(*) over()::integer as filtered_count
      from shorts_mvp.app_users app_user
      left join shorts_mvp.referral_partners referral_partner
        on referral_partner.id=app_user.referral_partner_id
      left join lateral (
        select candidate.*
        from shorts_mvp.user_subscriptions candidate
        where candidate.user_id=app_user.id
        order by
          case when candidate.status in ('pending','trialing','active','past_due') then 0 else 1 end,
          candidate.created_at desc
        limit 1
      ) subscription on true
      where (
        ${filters.query}=''
        or lower(coalesce(app_user.email,'')) like ${`%${normalizedQuery}%`}
        or lower(coalesce(app_user.display_name,'')) like ${`%${normalizedQuery}%`}
        or app_user.id::text=${filters.query}
      )
      and (
        ${filters.memberType}='all'
        or (${filters.memberType}='free' and subscription.id is null)
        or (
          ${filters.memberType}='paid_active'
          and subscription.status in ('active','trialing')
          and coalesce(subscription.billing_review_status,'')<>'manual_review'
        )
        or (
          ${filters.memberType}='paid_attention'
          and (
            subscription.status='past_due'
            or subscription.billing_review_status='manual_review'
          )
        )
        or (
          ${filters.memberType}='paid_inactive'
          and subscription.status in ('canceled','expired','paused')
        )
      )
      and (
        ${filters.memberPlan}='all'
        or (${filters.memberPlan}='monthly' and subscription.billing_cycle='monthly')
        or (${filters.memberPlan}='starter' and subscription.plan_code like 'starter_%')
        or (${filters.memberPlan}='expert' and subscription.plan_code like 'expert_%')
      )
      and (
        ${filters.memberActivity}='all'
        or (
          ${filters.memberActivity}='with_projects'
          and exists (
            select 1 from shorts_mvp.video_jobs project
            where project.user_id=app_user.id
          )
        )
        or (
          ${filters.memberActivity}='with_shorts'
          and exists (
            select 1 from shorts_mvp.generated_shorts generated_short
            where generated_short.user_id=app_user.id
          )
        )
        or (
          ${filters.memberActivity}='no_projects'
          and not exists (
            select 1 from shorts_mvp.video_jobs project
            where project.user_id=app_user.id
          )
        )
      )
      and (
        ${filters.memberReferrer}='all'
        or (${filters.memberReferrer}='none' and app_user.referral_partner_id is null)
        or (${filters.memberReferrer}='referred' and app_user.referral_partner_id is not null)
        or app_user.referral_partner_id::text=${filters.memberReferrer}
      )
    ),
    page_users as (
      select *
      from filtered_users
      order by sort_at desc,id desc
      limit ${ADMIN_MEMBER_PAGE_SIZE + 1}
      offset ${offset}
    )
    select
      page_user.*,
      payment_method.issuer_name,payment_method.card_number_masked,
      coalesce(projects.project_count,0)::integer as project_count,
      coalesce(shorts.short_count,0)::integer as short_count,
      coalesce(current_usage.limit_seconds,0)::bigint as usage_limit_seconds,
      coalesce(current_usage.consumed_seconds,0)::bigint as usage_consumed_seconds,
      coalesce(current_usage.reserved_seconds,0)::bigint as usage_reserved_seconds
    from page_users page_user
    left join shorts_mvp.billing_payment_methods payment_method
      on payment_method.id=page_user.payment_method_id
    left join lateral (
      select count(*)::integer as project_count
      from shorts_mvp.video_jobs project
      where project.user_id=page_user.id
    ) projects on true
    left join lateral (
      select count(*)::integer as short_count
      from shorts_mvp.generated_shorts generated_short
      where generated_short.user_id=page_user.id
    ) shorts on true
    left join lateral (
      select
        coalesce(sum(grant_row.total_seconds),0)::bigint as limit_seconds,
        coalesce(sum(grant_row.consumed_seconds),0)::bigint as consumed_seconds,
        coalesce(sum(grant_row.reserved_seconds),0)::bigint as reserved_seconds
      from shorts_mvp.usage_grants grant_row
      where grant_row.user_id=page_user.id
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
              or page_user.manual_service_access_until>clock_timestamp()
              or exists (
                select 1
                from shorts_mvp.user_subscriptions active_subscription
                where active_subscription.user_id=page_user.id
                  and active_subscription.status='active'
                  and active_subscription.current_period_start<=clock_timestamp()
                  and active_subscription.current_period_end>clock_timestamp()
              )
            )
          )
        )
    ) current_usage on true
    order by page_user.sort_at desc,page_user.id desc
  `;
  const hasMore = rows.length > ADMIN_MEMBER_PAGE_SIZE;
  const visibleRows = rows.slice(0, ADMIN_MEMBER_PAGE_SIZE);

  return {
    members: visibleRows.map((row) => toAdminMember(row)),
    totalCount: Number(rows[0]?.filteredCount || 0),
    hasMore,
    nextOffset: offset + visibleRows.length,
  };
}
