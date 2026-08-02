import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/admin";
import { addKstMonths } from "@/lib/billing";
import { ensureLocalDbReady, getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getPrepaidPackageMonthState } from "@/lib/refund-policy";
import { createNoIndexMetadata } from "@/lib/seo";
import { AdminBillingDashboard, type AdminOrder, type AdminRefund } from "./admin-billing-dashboard";
import {
  AdminFeedbackDashboard,
  type AdminProjectFeedback,
  type AdminProjectFeedbackMetrics,
} from "./admin-feedback-dashboard";
import {
  AdminInquiriesDashboard,
  type AdminCustomerInquiry,
  type AdminInquiryMetrics,
} from "./admin-inquiries-dashboard";
import { AdminMembersDashboard, type AdminMember } from "./admin-members-dashboard";
import { AdminManagedAccountsSection } from "./admin-managed-accounts-section";
import { AdminInstallmentsDashboard } from "./admin-installments-dashboard";
import { AdminRuntimeSettings } from "./admin-runtime-settings";
import {
  AdminShell,
  type AdminMemberTrendPoint,
  type AdminSalesTrendPoint,
  type AdminTab,
} from "./admin-shell";
import {
  AdminEditorReleases,
  type AdminEditorRelease,
  type AdminEditorReleaseCheck,
  type AdminEditorReleaseRenderStats,
  type AdminEditorReleaseTester,
} from "./admin-editor-releases";
import { AdminReferralsSection } from "./admin-referrals-section";
import {
  AdminRefundsDashboard,
  type AdminRefundCase,
  type AdminRefundCaseMetrics,
} from "./admin-refunds-dashboard";
import {
  AdminOnboardingDashboard,
  type AdminUserOnboardingMetrics,
  type AdminUserOnboardingResponse,
} from "./admin-onboarding-dashboard";
import {
  editorRenderingV2GlobalEnabled,
  editorRenderingV2MasterEnabled,
} from "@/lib/editor-rendering-release";
import {
  LOGIN_WELCOME_GRANT_FLAG_KEY,
  ONBOARDING_WELCOME_PRODUCT_CODE,
  onboardingWelcomeGrantEnabled,
} from "@/lib/onboarding-welcome";
import {
  userOccupationValues,
  userUsagePurposeValues,
  type UserOccupation,
  type UserUsagePurpose,
} from "@/lib/user-onboarding";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexMetadata(
  "관리자",
  "Easy Cut 관리자 전용 운영 화면입니다.",
);

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}
function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;
}

export default async function AdminBillingPage({ searchParams }: PageProps) {
  await ensureLocalDbReady();

  let admin: Awaited<ReturnType<typeof requireAdminUser>>;
  try {
    admin = await requireAdminUser();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      redirect(`/auth/sign-in?next=${encodeURIComponent("/admin/easycutcutcutcutcutcut")}`);
    }
    notFound();
  }

  const params = await searchParams;
  const requestedTab = first(params.tab);
  const validTabs: AdminTab[] = [
    "billing",
    "refunds",
    "members",
    "managed-accounts",
    "referrals",
    "inquiries",
    "feedback",
    "onboarding",
    "settings",
    "installments",
    "editor-releases",
  ];
  const tab: AdminTab = validTabs.includes(requestedTab as AdminTab)
    ? requestedTab as AdminTab
    : "billing";
  const requestedStatus = first(params.status);
  const requestedProvider = first(params.provider);
  const status = ["pending", "processing", "succeeded", "failed", "unknown", "manual_review", "canceled", "expired"].includes(requestedStatus)
    ? requestedStatus
    : "all";
  const provider = ["nicepay", "thepayone"].includes(requestedProvider) ? requestedProvider : "all";
  const requestedRefundStatus = first(params.refundStatus);
  const refundCaseStatus = ["unprocessed", "in_progress", "completed", "manual_review", "closed"].includes(requestedRefundStatus)
    ? requestedRefundStatus
    : "all";
  const query = first(params.q).trim().slice(0, 100);
  const requestedMemberType = first(params.memberType);
  const memberType = ["free", "paid_active", "paid_attention", "paid_inactive"].includes(requestedMemberType)
    ? requestedMemberType
    : "all";
  const requestedMemberPlan = first(params.memberPlan);
  const memberPlan = ["monthly", "starter", "expert"].includes(requestedMemberPlan)
    ? requestedMemberPlan
    : "all";
  const requestedMemberActivity = first(params.memberActivity);
  const memberActivity = ["with_projects", "with_shorts", "no_projects"].includes(requestedMemberActivity)
    ? requestedMemberActivity
    : "all";
  const memberReferrer = first(params.memberReferrer) || "all";
  const requestedInquiryStatus = first(params.inquiryStatus);
  const inquiryStatus = ["open", "new", "in_progress", "waiting_on_customer", "resolved", "closed"].includes(requestedInquiryStatus)
    ? requestedInquiryStatus
    : "open";
  const requestedInquiryCategory = first(params.inquiryCategory);
  const inquiryCategory = ["service_usage", "billing_refund", "technical_issue", "other"].includes(requestedInquiryCategory)
    ? requestedInquiryCategory
    : "all";
  const requestedInquiryKind = first(params.inquiryKind);
  const inquiryKind = ["general", "refund_request"].includes(requestedInquiryKind)
    ? requestedInquiryKind
    : "all";
  const db = getDb();
  const [
    runtimeSettingRows,
    metricRows,
    subscriptionRows,
    salesTrendRows,
    memberTrendRows,
  ] = await Promise.all([
    tab === "settings" ? db`
        select feature_flag.enabled,feature_flag.updated_at,administrator.email as updated_by_email
        from shorts_mvp.runtime_feature_flags feature_flag
        left join shorts_mvp.app_users administrator
          on administrator.id=feature_flag.updated_by_user_id
        where feature_flag.flag_key=${LOGIN_WELCOME_GRANT_FLAG_KEY}
        limit 1
      ` : Promise.resolve([]),
    db`
      select
        coalesce(sum(amount_krw) filter (where status='succeeded'),0)::bigint as gross_sales,
        coalesce(sum(refunded_amount_krw),0)::bigint as refunded_sales,
        coalesce(sum(amount_krw-refunded_amount_krw) filter (where status='succeeded'),0)::bigint as net_sales,
        coalesce(sum(amount_krw) filter (
          where status='succeeded'
            and amount_krw>0
            and approved_at >= (
              date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul')
              at time zone 'Asia/Seoul'
            )
        ),0)::bigint as today_sales,
        count(*) filter (
          where status='succeeded' and amount_krw>0
        )::integer as paid_orders,
        count(*) filter (where status in ('unknown','manual_review'))::integer as review_orders
      from shorts_mvp.billing_orders
    `,
    db`
      select
        count(*) filter (where subscription.status='active')::integer as active,
        count(*) filter (where subscription.status='past_due')::integer as past_due,
        count(*) filter (
          where subscription.billing_review_status='manual_review'
        )::integer as manual_review,
        count(*) filter (
          where subscription.status='active'
            and subscription.plan_code='easycut_pro_v2'
        )::integer as active_pro,
        coalesce(sum(plan.monthly_price_krw) filter (
          where subscription.status='active'
            and subscription.plan_code='easycut_pro_v2'
        ),0)::bigint as active_billing_krw
      from shorts_mvp.user_subscriptions subscription
      left join shorts_mvp.plans plan on plan.code=subscription.plan_code
    `,
    db`
      with days as (
        select generate_series(
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days',
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul'),
          interval '1 day'
        )::date as trend_day
      ),
      daily_sales as (
        select
          (approved_at at time zone 'Asia/Seoul')::date as trend_day,
          coalesce(sum(amount_krw),0)::bigint as sales,
          count(*)::integer as order_count
        from shorts_mvp.billing_orders
        where status='succeeded'
          and amount_krw>0
          and approved_at >= (
            date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days'
          ) at time zone 'Asia/Seoul'
        group by (approved_at at time zone 'Asia/Seoul')::date
      )
      select
        to_char(days.trend_day,'YYYY-MM-DD') as date,
        coalesce(daily_sales.sales,0)::bigint as sales,
        coalesce(daily_sales.order_count,0)::integer as order_count
      from days
      left join daily_sales using (trend_day)
      order by days.trend_day
    `,
    db`
      with days as (
        select generate_series(
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days',
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul'),
          interval '1 day'
        )::date as trend_day
      ),
      daily_members as (
        select
          (created_at at time zone 'Asia/Seoul')::date as trend_day,
          count(*)::integer as member_count
        from shorts_mvp.app_users
        where created_at >= (
          date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') - interval '13 days'
        ) at time zone 'Asia/Seoul'
        group by (created_at at time zone 'Asia/Seoul')::date
      )
      select
        to_char(days.trend_day,'YYYY-MM-DD') as date,
        coalesce(daily_members.member_count,0)::integer as member_count
      from days
      left join daily_members using (trend_day)
      order by days.trend_day
    `,
  ]);
  const [
    editorReleaseStateRows,
    editorReleaseRows,
    editorReleaseCheckRows,
    editorReleaseTesterRows,
    editorReleaseRenderStatsRows,
  ] = tab === "editor-releases"
    ? await Promise.all([
        db`
          select stable_release_id,previous_stable_release_id,
            candidate_release_id,public_enabled,canary_enabled
          from shorts_mvp.editor_release_state
          where singleton=true
          limit 1
        `,
        db`
          select id,git_sha,ui_version,document_version,
            worker_image_digest,production_job_definition_arn,status,
            created_at,staging_verified_at,canary_started_at,promoted_at
          from shorts_mvp.editor_releases
          order by created_at desc
          limit 30
        `,
        db`
          select release_id,environment,check_name,status,updated_at
          from shorts_mvp.editor_release_checks
          where release_id in (
            select id
            from shorts_mvp.editor_releases
            order by created_at desc
            limit 30
          )
          order by updated_at desc
        `,
        db`
          select tester.user_id,user.email,user.display_name,
            tester.enabled,tester.updated_at
          from shorts_mvp.editor_release_testers tester
          join shorts_mvp.app_users user on user.id=tester.user_id
          order by tester.enabled desc,tester.updated_at desc
        `,
        db`
          select release_id,
            count(*) filter (
              where status in ('queued','rendering')
            )::integer as active,
            count(*) filter (where status='failed')::integer as failed,
            count(*) filter (where status='succeeded')::integer as succeeded
          from shorts_mvp.editor_render_requests
          where release_id is not null
          group by release_id
        `,
      ])
    : [[], [], [], [], []];
  const orderRows = tab === "billing" ? await db`
      select o.id,o.order_id,o.kind,o.product_code,o.billing_cycle,o.amount_krw,
        o.refunded_amount_krw,o.refund_status,o.status,o.provider,o.provider_transaction_id,
        o.provider_status,o.failure_code,o.provider_terminal_id,o.installment_months,
        (o.payment_method_id is not null) as has_payment_method,
        nullif(o.installment_terms_snapshot->>'credentialScope','') as credential_scope,
        coalesce(
          nullif(o.installment_terms_snapshot->>'issuerName',''),
          nullif(pm.issuer_name,'')
        ) as card_issuer_name,
        nullif(o.installment_terms_snapshot->>'benefitType','') as installment_benefit_type,
        nullif(o.installment_terms_snapshot->>'declaredCardKind','') as declared_card_kind,
        o.renewal_period_start,o.approved_at,o.created_at,o.refund_policy_version,u.email,
        s.status as subscription_status,p.prepaid_months,
        coalesce(ur.reserved_refund_krw,0)::integer as reserved_refund_krw,
        coalesce(pfu.usage_count,0)::integer as popular_filter_usage_count,
        pfu.last_used_at as popular_filter_last_used_at,
        bua.last_allocated_at as last_base_allocated_at,
        ebook.last_downloaded_at as ebook_last_downloaded_at,
        first_job.completed_at as first_completed_job_at
      from shorts_mvp.billing_orders o
      join shorts_mvp.app_users u on u.id=o.user_id
      left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
      left join shorts_mvp.plans p on p.code=o.product_code
      left join shorts_mvp.billing_payment_methods pm on pm.id=o.payment_method_id
      left join (
        select source_order_id, sum(refund_amount_krw)::integer as reserved_refund_krw
        from shorts_mvp.subscription_upgrade_refunds
        where status in ('pending','submitted','manual_review')
        group by source_order_id
      ) ur on ur.source_order_id=o.id
      left join lateral (
        select max(a.created_at) as last_allocated_at
        from shorts_mvp.usage_grants g
        join shorts_mvp.usage_grant_allocations a on a.grant_id=g.id
        where g.billing_order_id=o.id and g.kind='base'
          and a.status in ('reserved','consumed')
      ) bua on true
      left join lateral (
        select count(*)::integer as usage_count,max(occurred_at) as last_used_at
        from shorts_mvp.popular_filter_usage_events
        where billing_order_id=o.id
      ) pfu on true
      left join lateral (
        select max(last_downloaded_at) as last_downloaded_at
        from shorts_mvp.ebook_download_counters
        where user_id=o.user_id
          and last_downloaded_at >= coalesce(o.renewal_period_start,o.approved_at)
      ) ebook on true
      left join lateral (
        select j.completed_at
        from shorts_mvp.usage_grants g
        join shorts_mvp.usage_grant_allocations a
          on a.grant_id=g.id and a.status='consumed'
        join shorts_mvp.usage_reservations ur
          on ur.id=a.reservation_id and ur.status='consumed'
        join shorts_mvp.video_jobs j
          on j.id=ur.job_id and j.status='completed' and j.completed_at is not null
        where g.billing_order_id=o.id
        order by j.completed_at,j.created_at,j.id
        limit 1
      ) first_job on true
      where (${status}='all' or o.status=${status})
        and (${provider}='all' or o.provider=${provider})
        and (
          ${query}=''
          or lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
          or lower(o.order_id) like ${`%${query.toLowerCase()}%`}
          or lower(coalesce(o.provider_transaction_id,'')) like ${`%${query.toLowerCase()}%`}
        )
      order by o.created_at desc
      limit 500
    ` : [];
  const refundRows = tab === "billing" ? await db`
      select r.id,r.billing_order_id,r.amount_krw,r.reason,r.status,
        r.entitlement_action_status,r.provider_refund_transaction_id,r.failure_message,
        r.requested_at,r.processed_at,o.order_id,u.email,a.email as admin_email
      from shorts_mvp.admin_billing_refunds r
      join shorts_mvp.billing_orders o on o.id=r.billing_order_id
      join shorts_mvp.app_users u on u.id=o.user_id
      join shorts_mvp.app_users a on a.id=r.requested_by_user_id
      order by r.requested_at desc
      limit 50
    ` : [];
  const refundCaseRows = tab === "refunds" ? await db`
      select
        c.*,o.order_id,o.product_code,o.order_name,o.amount_krw as order_amount_krw,
        o.refunded_amount_krw as order_refunded_amount_krw,o.approved_at,o.provider,
        o.provider_transaction_id,u.email,u.display_name,
        coalesce(p.display_name,o.order_name) as product_name,
        s.status as subscription_status,
        assigned.email as assigned_admin_email
      from shorts_mvp.admin_refund_cases c
      join shorts_mvp.billing_orders o on o.id=c.billing_order_id
      join shorts_mvp.app_users u on u.id=c.user_id
      left join shorts_mvp.plans p on p.code=o.product_code
      left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
      left join shorts_mvp.app_users assigned on assigned.id=c.assigned_to_user_id
      where (${refundCaseStatus}='all' or c.status=${refundCaseStatus})
        and (
          ${query}=''
          or lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
          or lower(coalesce(u.display_name,'')) like ${`%${query.toLowerCase()}%`}
          or lower(o.order_id) like ${`%${query.toLowerCase()}%`}
          or lower(coalesce(o.provider_transaction_id,'')) like ${`%${query.toLowerCase()}%`}
          or c.id::text=${query}
          or u.id::text=${query}
        )
      order by
        case c.status
          when 'manual_review' then 0
          when 'unprocessed' then 1
          when 'in_progress' then 2
          when 'completed' then 3
          else 4
        end,
        c.updated_at desc
      limit 500
    ` : [];
  const refundCaseMetricRows = tab === "refunds" ? await db`
      select
        count(*) filter (where status='unprocessed')::integer as unprocessed,
        count(*) filter (where status='in_progress')::integer as in_progress,
        count(*) filter (where status='completed')::integer as completed,
        count(*) filter (where status='manual_review')::integer as manual_review,
        coalesce(sum(planned_refund_krw) filter (
          where payment_status='completed'
            and updated_at >= clock_timestamp()-interval '30 days'
        ),0)::bigint as recent_refund_krw
      from shorts_mvp.admin_refund_cases
    ` : [];
  const memberRows = tab === "members" ? await db`
      select
        u.id,u.email,u.display_name,u.created_at,u.last_sign_in_at,
        u.referral_partner_id,rp.creator_name as referral_creator_name,rp.slug as referral_slug,
        s.id as subscription_id,s.plan_code,s.billing_cycle,s.status as subscription_status,
        s.current_period_start,s.current_period_end,s.next_charge_at,
        s.provider_schedule_status,s.billing_review_status,s.billing_review_reason,
        s.payment_provider,m.issuer_name,m.card_number_masked,
        coalesce(projects.project_count,0)::integer as project_count,
        coalesce(shorts.short_count,0)::integer as short_count,
        coalesce(current_usage.limit_seconds,0)::bigint as usage_limit_seconds,
        coalesce(current_usage.consumed_seconds,0)::bigint as usage_consumed_seconds,
        coalesce(current_usage.reserved_seconds,0)::bigint as usage_reserved_seconds,
        count(*) over()::integer as filtered_count
      from shorts_mvp.app_users u
      left join shorts_mvp.referral_partners rp on rp.id=u.referral_partner_id
      left join lateral (
        select subscription.*
        from shorts_mvp.user_subscriptions subscription
        where subscription.user_id=u.id
        order by
          case when subscription.status in ('pending','trialing','active','past_due') then 0 else 1 end,
          subscription.created_at desc
        limit 1
      ) s on true
      left join shorts_mvp.billing_payment_methods m on m.id=s.payment_method_id
      left join lateral (
        select count(*)::integer as project_count
        from shorts_mvp.video_jobs project
        where project.user_id=u.id
      ) projects on true
      left join lateral (
        select count(*)::integer as short_count
        from shorts_mvp.generated_shorts generated_short
        where generated_short.user_id=u.id
      ) shorts on true
      left join lateral (
        select
          coalesce(sum(grant_row.total_seconds),0)::bigint as limit_seconds,
          coalesce(sum(grant_row.consumed_seconds),0)::bigint as consumed_seconds,
          coalesce(sum(grant_row.reserved_seconds),0)::bigint as reserved_seconds
        from shorts_mvp.usage_grants grant_row
        where grant_row.user_id=u.id
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
                grant_row.product_code=${ONBOARDING_WELCOME_PRODUCT_CODE}
                or u.manual_service_access_until>clock_timestamp()
                or exists (
                  select 1
                  from shorts_mvp.user_subscriptions active_subscription
                  where active_subscription.user_id=u.id
                    and active_subscription.status='active'
                    and active_subscription.current_period_start<=clock_timestamp()
                    and active_subscription.current_period_end>clock_timestamp()
                )
              )
            )
          )
      ) current_usage on true
      where (
        ${query}=''
        or lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(u.display_name,'')) like ${`%${query.toLowerCase()}%`}
        or u.id::text=${query}
      )
      and (
        ${memberType}='all'
        or (${memberType}='free' and s.id is null)
        or (${memberType}='paid_active' and s.status in ('active','trialing') and coalesce(s.billing_review_status,'')<>'manual_review')
        or (${memberType}='paid_attention' and (s.status='past_due' or s.billing_review_status='manual_review'))
        or (${memberType}='paid_inactive' and s.status in ('canceled','expired','paused'))
      )
      and (
        ${memberPlan}='all'
        or (${memberPlan}='monthly' and s.billing_cycle='monthly')
        or (${memberPlan}='starter' and s.plan_code like 'starter_%')
        or (${memberPlan}='expert' and s.plan_code like 'expert_%')
      )
      and (
        ${memberActivity}='all'
        or (${memberActivity}='with_projects' and coalesce(projects.project_count,0)>0)
        or (${memberActivity}='with_shorts' and coalesce(shorts.short_count,0)>0)
        or (${memberActivity}='no_projects' and coalesce(projects.project_count,0)=0)
      )
      and (
        ${memberReferrer}='all'
        or (${memberReferrer}='none' and u.referral_partner_id is null)
        or (${memberReferrer}='referred' and u.referral_partner_id is not null)
        or u.referral_partner_id::text=${memberReferrer}
      )
      order by coalesce(u.last_sign_in_at,u.created_at) desc
    ` : [];
  const memberReferralOptionRows = tab === "members" ? await db`
      select id,creator_name,slug
      from shorts_mvp.referral_partners
      order by creator_name,slug
    ` : [];
  const feedbackRows = tab === "feedback" ? await db`
      select f.id,f.satisfaction_rating,f.disappointment_reason,f.improvement_text,
        f.prompt_completion_count,f.completed_project_count,f.reward_seconds,f.created_at,
        u.email,u.display_name
      from shorts_mvp.project_feedback_responses f
      join shorts_mvp.app_users u on u.id=f.user_id
      where (
        ${query}=''
        or lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(u.display_name,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(f.improvement_text,'')) like ${`%${query.toLowerCase()}%`}
      )
      order by f.created_at desc
      limit 200
    ` : [];
  const feedbackMetricRows = tab === "feedback" ? await db`
      select
        count(*)::integer as response_count,
        coalesce(avg(satisfaction_rating),0)::numeric as average_rating,
        coalesce(sum(reward_seconds) / 60,0)::integer as reward_minutes
      from shorts_mvp.project_feedback_responses
    ` : [];
  const feedbackDeferralMetricRows = tab === "feedback" ? await db`
      select
        count(*)::integer as deferral_count,
        count(distinct user_id) filter (where completed_project_count>=12)::integer
          as permanently_dismissed_count
      from shorts_mvp.project_feedback_prompt_deferrals
    ` : [];
  const feedbackReasonRows = tab === "feedback" ? await db`
      select disappointment_reason,count(*)::integer as count
      from shorts_mvp.project_feedback_responses
      group by disappointment_reason
      order by count desc,disappointment_reason
    ` : [];
  const inquiryRows = tab === "inquiries" ? await db`
      select
        i.id,i.category,i.status,i.contact_email,i.message,i.locale,i.page_path,
        i.inquiry_kind,i.refund_reason_code,i.billing_order_id,i.resolved_at,
        i.created_at,i.updated_at,u.email as member_email,u.display_name as member_display_name,
        o.order_id,o.product_code,o.amount_krw as order_amount_krw,
        o.refunded_amount_krw as order_refunded_amount_krw,o.status as order_status
      from shorts_mvp.customer_inquiries i
      left join shorts_mvp.app_users u on u.id=i.user_id
      left join shorts_mvp.billing_orders o on o.id=i.billing_order_id
      where (
        (${inquiryStatus}='open' and i.status in ('new','in_progress','waiting_on_customer'))
        or (${inquiryStatus}<>'open' and i.status=${inquiryStatus})
      )
        and (${inquiryCategory}='all' or i.category=${inquiryCategory})
        and (${inquiryKind}='all' or i.inquiry_kind=${inquiryKind})
        and (
          ${query}=''
          or lower(i.contact_email) like ${`%${query.toLowerCase()}%`}
          or lower(i.message) like ${`%${query.toLowerCase()}%`}
          or lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
          or lower(coalesce(u.display_name,'')) like ${`%${query.toLowerCase()}%`}
          or lower(coalesce(o.order_id,'')) like ${`%${query.toLowerCase()}%`}
          or i.id::text=${query}
      )
      order by i.created_at desc
    ` : [];
  const inquiryMetricRows = tab === "inquiries" ? await db`
      select
        count(*)::integer as total_count,
        count(*) filter (where status='new')::integer as new_count,
        count(*) filter (where status='in_progress')::integer as in_progress_count,
        count(*) filter (where status='waiting_on_customer')::integer as waiting_count,
        count(*) filter (where inquiry_kind='refund_request')::integer as refund_request_count
      from shorts_mvp.customer_inquiries
    ` : [];
  const onboardingRows = tab === "onboarding" ? await db`
      select
        p.user_id,p.occupation,p.occupation_other,p.usage_purposes,
        p.usage_purpose_other,p.onboarding_version,p.completed_at,
        u.email,u.display_name
      from shorts_mvp.user_onboarding_profiles p
      join shorts_mvp.app_users u on u.id=p.user_id
      where (
        ${query}=''
        or lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(u.display_name,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(p.occupation_other,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(p.usage_purpose_other,'')) like ${`%${query.toLowerCase()}%`}
        or p.user_id::text=${query}
      )
      order by p.completed_at desc
      limit 200
    ` : [];
  const onboardingMetricRows = tab === "onboarding" ? await db`
      select
        (select count(*) from shorts_mvp.user_onboarding_profiles)::integer as response_count,
        (select count(*) from shorts_mvp.app_users)::integer as total_member_count
    ` : [];
  const onboardingOccupationCountRows = tab === "onboarding" ? await db`
      select occupation,count(*)::integer as count
      from shorts_mvp.user_onboarding_profiles
      group by occupation
      order by count desc,occupation
    ` : [];
  const onboardingUsagePurposeCountRows = tab === "onboarding" ? await db`
      select selected.purpose,count(*)::integer as count
      from shorts_mvp.user_onboarding_profiles p
      cross join lateral unnest(p.usage_purposes) as selected(purpose)
      group by selected.purpose
      order by count desc,selected.purpose
    ` : [];

  const metrics = metricRows[0] || {};
  const subscriptions = subscriptionRows[0] || {};
  const salesTrend: AdminSalesTrendPoint[] = salesTrendRows.map((row) => ({
    date: String(row.date),
    sales: Number(row.sales || 0),
    orderCount: Number(row.orderCount || 0),
  }));
  const memberTrend: AdminMemberTrendPoint[] = memberTrendRows.map((row) => ({
    date: String(row.date),
    memberCount: Number(row.memberCount || 0),
  }));
  const orders: AdminOrder[] = orderRows.map((row) => {
    const contractStart = row.renewalPeriodStart instanceof Date
      ? row.renewalPeriodStart
      : row.approvedAt instanceof Date
        ? row.approvedAt
        : null;
    const contractMonths = row.billingCycle === "yearly" ? Number(row.prepaidMonths || 12) : 1;
    const packageMonthState = contractStart
      ? getPrepaidPackageMonthState({
        periodStart: contractStart,
        prepaidMonths: contractMonths,
      })
      : null;
    const isInCurrentPackageMonth = (value: unknown) => (
      value instanceof Date
      && packageMonthState?.currentMonthStart instanceof Date
      && packageMonthState.currentMonthEnd instanceof Date
      && value >= packageMonthState.currentMonthStart
      && value < packageMonthState.currentMonthEnd
    );
    return {
      id: row.id,
      orderId: row.orderId,
      kind: row.kind,
      productCode: row.productCode || "unknown",
      billingCycle: row.billingCycle || null,
      prepaidMonths: contractMonths,
      refundPolicyVersion: Number(row.refundPolicyVersion || 1),
      amountKrw: Number(row.amountKrw),
      refundedAmountKrw: Number(row.refundedAmountKrw || 0),
      reservedRefundKrw: Number(row.reservedRefundKrw || 0),
      refundStatus: row.refundStatus,
      status: row.status,
      provider: row.provider,
      providerTransactionId: row.providerTransactionId || null,
      providerStatus: row.providerStatus || null,
      providerTerminalId: row.providerTerminalId || null,
      hasPaymentMethod: Boolean(row.hasPaymentMethod),
      credentialScope: row.credentialScope || null,
      installmentMonths: Number(row.installmentMonths || 0),
      cardIssuerName: row.cardIssuerName || null,
      installmentBenefitType: row.installmentBenefitType || null,
      declaredCardKind: row.declaredCardKind || null,
      failureCode: row.failureCode || null,
      approvedAt: iso(row.approvedAt),
      createdAt: iso(row.createdAt)!,
      email: row.email || "-",
      subscriptionStatus: row.subscriptionStatus || null,
      contractPeriodStart: iso(contractStart),
      contractPeriodEnd: contractStart ? addKstMonths(contractStart, contractMonths).toISOString() : null,
      currentPackageMonthUsed:
        isInCurrentPackageMonth(row.lastBaseAllocatedAt)
        || isInCurrentPackageMonth(row.popularFilterLastUsedAt)
        || isInCurrentPackageMonth(row.ebookLastDownloadedAt),
      firstCompletedJobAt: iso(row.firstCompletedJobAt),
      popularFilterUsageCount: Number(row.popularFilterUsageCount || 0),
      popularFilterLastUsedAt: iso(row.popularFilterLastUsedAt),
    };
  });
  const refunds: AdminRefund[] = refundRows.map((row) => ({
    id: row.id,
    billingOrderId: row.billingOrderId,
    orderId: row.orderId,
    email: row.email || "-",
    adminEmail: row.adminEmail || "-",
    amountKrw: Number(row.amountKrw),
    reason: row.reason,
    status: row.status,
    entitlementActionStatus: row.entitlementActionStatus,
    providerRefundTransactionId: row.providerRefundTransactionId || null,
    failureMessage: row.failureMessage || null,
    requestedAt: iso(row.requestedAt)!,
    processedAt: iso(row.processedAt),
  }));
  const refundCases: AdminRefundCase[] = refundCaseRows.map((row) => ({
    id: row.id,
    billingOrderId: row.billingOrderId,
    orderId: row.orderId,
    productCode: row.productCode,
    productName: row.productName || row.orderName || row.productCode,
    orderAmountKrw: Number(row.orderAmountKrw || 0),
    orderRefundedAmountKrw: Number(row.orderRefundedAmountKrw || 0),
    approvedAt: iso(row.approvedAt),
    provider: row.provider,
    providerTransactionId: row.providerTransactionId || null,
    userId: row.userId,
    email: row.email || "-",
    displayName: row.displayName || null,
    status: row.status,
    reasonCode: row.reasonCode,
    reasonDetail: row.reasonDetail,
    firstJobCompleted: Boolean(row.firstJobCompleted),
    firstCompletedJobAt: iso(row.firstCompletedJobAt),
    prepaidMonths: Number(row.prepaidMonths || 1),
    monthlyDeductionKrw: Number(row.monthlyDeductionKrw || 0),
    calculatedRefundKrw: Number(row.calculatedRefundKrw || 0),
    plannedRefundKrw: Number(row.plannedRefundKrw || 0),
    refundAction: row.refundAction,
    paymentStatus: row.paymentStatus,
    billingAction: row.billingAction,
    entitlementAction: row.entitlementAction,
    entitlementEffectiveAt: iso(row.entitlementEffectiveAt),
    serviceActionStatus: row.serviceActionStatus,
    providerReference: row.providerReference || null,
    adminNote: row.adminNote || null,
    subscriptionStatus: row.subscriptionStatus || null,
    assignedAdminEmail: row.assignedAdminEmail || null,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  }));
  const refundCaseMetrics: AdminRefundCaseMetrics = {
    unprocessed: Number(refundCaseMetricRows[0]?.unprocessed || 0),
    inProgress: Number(refundCaseMetricRows[0]?.inProgress || 0),
    completed: Number(refundCaseMetricRows[0]?.completed || 0),
    manualReview: Number(refundCaseMetricRows[0]?.manualReview || 0),
    recentRefundKrw: Number(refundCaseMetricRows[0]?.recentRefundKrw || 0),
  };
  const members: AdminMember[] = memberRows.map((row) => ({
    id: row.id,
    email: row.email || "-",
    displayName: row.displayName || null,
    createdAt: iso(row.createdAt)!,
    lastSignInAt: iso(row.lastSignInAt),
    subscriptionId: row.subscriptionId || null,
    planCode: row.planCode || null,
    billingCycle: row.billingCycle || null,
    subscriptionStatus: row.subscriptionStatus || null,
    currentPeriodStart: iso(row.currentPeriodStart),
    currentPeriodEnd: iso(row.currentPeriodEnd),
    nextChargeAt: iso(row.nextChargeAt),
    providerScheduleStatus: row.providerScheduleStatus || null,
    billingReviewStatus: row.billingReviewStatus || null,
    billingReviewReason: row.billingReviewReason || null,
    paymentProvider: row.paymentProvider || null,
    cardIssuer: row.issuerName || null,
    cardNumberMasked: row.cardNumberMasked || null,
    projectCount: Number(row.projectCount || 0),
    shortCount: Number(row.shortCount || 0),
    usageLimitSeconds: Number(row.usageLimitSeconds || 0),
    usageConsumedSeconds: Number(row.usageConsumedSeconds || 0),
    usageReservedSeconds: Number(row.usageReservedSeconds || 0),
    usageRemainingSeconds: Math.max(
      0,
      Number(row.usageLimitSeconds || 0)
        - Number(row.usageConsumedSeconds || 0)
        - Number(row.usageReservedSeconds || 0),
    ),
    referralPartnerId: row.referralPartnerId || null,
    referralCreatorName: row.referralCreatorName || null,
    referralSlug: row.referralSlug || null,
  }));
  const filteredMemberCount = Number(memberRows[0]?.filteredCount || 0);
  const feedback: AdminProjectFeedback[] = feedbackRows.map((row) => ({
    id: row.id,
    email: row.email || "-",
    displayName: row.displayName || null,
    satisfactionRating: Number(row.satisfactionRating),
    disappointmentReason: row.disappointmentReason,
    improvementText: row.improvementText || null,
    promptCompletionCount: Number(row.promptCompletionCount),
    completedProjectCount: Number(row.completedProjectCount),
    rewardSeconds: Number(row.rewardSeconds),
    createdAt: iso(row.createdAt)!,
  }));
  const feedbackMetrics: AdminProjectFeedbackMetrics = {
    responseCount: Number(feedbackMetricRows[0]?.responseCount || 0),
    averageRating: Number(feedbackMetricRows[0]?.averageRating || 0),
    rewardMinutes: Number(feedbackMetricRows[0]?.rewardMinutes || 0),
    deferralCount: Number(feedbackDeferralMetricRows[0]?.deferralCount || 0),
    permanentlyDismissedCount: Number(feedbackDeferralMetricRows[0]?.permanentlyDismissedCount || 0),
  };
  const inquiries: AdminCustomerInquiry[] = inquiryRows.map((row) => ({
    id: row.id,
    category: row.category,
    status: row.status,
    contactEmail: row.contactEmail,
    message: row.message,
    locale: row.locale,
    pagePath: row.pagePath || null,
    inquiryKind: row.inquiryKind,
    refundReasonCode: row.refundReasonCode || null,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    resolvedAt: iso(row.resolvedAt),
    memberEmail: row.memberEmail || null,
    memberDisplayName: row.memberDisplayName || null,
    billingOrderId: row.billingOrderId || null,
    orderId: row.orderId || null,
    productCode: row.productCode || null,
    orderAmountKrw: row.orderAmountKrw === null || row.orderAmountKrw === undefined
      ? null
      : Number(row.orderAmountKrw),
    orderRefundedAmountKrw: row.orderRefundedAmountKrw === null
      || row.orderRefundedAmountKrw === undefined
      ? null
      : Number(row.orderRefundedAmountKrw),
    orderStatus: row.orderStatus || null,
  }));
  const inquiryMetrics: AdminInquiryMetrics = {
    totalCount: Number(inquiryMetricRows[0]?.totalCount || 0),
    newCount: Number(inquiryMetricRows[0]?.newCount || 0),
    inProgressCount: Number(inquiryMetricRows[0]?.inProgressCount || 0),
    waitingCount: Number(inquiryMetricRows[0]?.waitingCount || 0),
    refundRequestCount: Number(inquiryMetricRows[0]?.refundRequestCount || 0),
  };
  const validOccupations = new Set<string>(userOccupationValues);
  const validUsagePurposes = new Set<string>(userUsagePurposeValues);
  const onboardingResponses: AdminUserOnboardingResponse[] = onboardingRows
    .filter((row) => validOccupations.has(String(row.occupation)))
    .map((row) => ({
      userId: row.userId,
      email: row.email || "-",
      displayName: row.displayName || null,
      occupation: row.occupation as UserOccupation,
      occupationOther: row.occupationOther || null,
      usagePurposes: (Array.isArray(row.usagePurposes) ? row.usagePurposes : [])
        .filter((purpose): purpose is UserUsagePurpose => validUsagePurposes.has(String(purpose))),
      usagePurposeOther: row.usagePurposeOther || null,
      onboardingVersion: Number(row.onboardingVersion || 1),
      completedAt: iso(row.completedAt)!,
    }));
  const onboardingMetrics: AdminUserOnboardingMetrics = {
    responseCount: Number(onboardingMetricRows[0]?.responseCount || 0),
    totalMemberCount: Number(onboardingMetricRows[0]?.totalMemberCount || 0),
  };
  const onboardingOccupationCounts = onboardingOccupationCountRows
    .filter((row) => validOccupations.has(String(row.occupation)))
    .map((row) => ({
      occupation: row.occupation as UserOccupation,
      count: Number(row.count || 0),
    }));
  const onboardingUsagePurposeCounts = onboardingUsagePurposeCountRows
    .filter((row) => validUsagePurposes.has(String(row.purpose)))
    .map((row) => ({
      purpose: row.purpose as UserUsagePurpose,
      count: Number(row.count || 0),
    }));
  const editorReleaseState = editorReleaseStateRows[0];
  const editorReleases: AdminEditorRelease[] = editorReleaseRows.map((row) => ({
    id: String(row.id),
    gitSha: String(row.gitSha),
    uiVersion: Number(row.uiVersion),
    documentVersion: Number(row.documentVersion),
    workerImageDigest: String(row.workerImageDigest),
    productionJobDefinitionArn: String(row.productionJobDefinitionArn),
    status: String(row.status),
    createdAt: iso(row.createdAt)!,
    stagingVerifiedAt: iso(row.stagingVerifiedAt),
    canaryStartedAt: iso(row.canaryStartedAt),
    promotedAt: iso(row.promotedAt),
  }));
  const editorReleaseChecks: AdminEditorReleaseCheck[] = editorReleaseCheckRows.map((row) => ({
    releaseId: String(row.releaseId),
    environment: row.environment as AdminEditorReleaseCheck["environment"],
    checkName: String(row.checkName),
    status: row.status as AdminEditorReleaseCheck["status"],
    updatedAt: iso(row.updatedAt)!,
  }));
  const editorReleaseTesters: AdminEditorReleaseTester[] = editorReleaseTesterRows.map((row) => ({
    userId: String(row.userId),
    email: String(row.email),
    displayName: row.displayName ? String(row.displayName) : null,
    enabled: Boolean(row.enabled),
    updatedAt: iso(row.updatedAt)!,
  }));
  const editorReleaseRenderStats: AdminEditorReleaseRenderStats[] =
    editorReleaseRenderStatsRows.map((row) => ({
      releaseId: String(row.releaseId),
      active: Number(row.active || 0),
      failed: Number(row.failed || 0),
      succeeded: Number(row.succeeded || 0),
    }));

  return (
    <AdminShell
      activeTab={tab}
      adminEmail={admin.email}
      metrics={{
        grossSales: Number(metrics.grossSales || 0),
        refundedSales: Number(metrics.refundedSales || 0),
        todaySales: Number(metrics.todaySales || 0),
        paidOrders: Number(metrics.paidOrders || 0),
        orderReviewCount: Number(metrics.reviewOrders || 0),
        activeSubscriptions: Number(subscriptions.active || 0),
        pastDueSubscriptions: Number(subscriptions.pastDue || 0),
        manualReviewSubscriptions: Number(subscriptions.manualReview || 0),
        activeProSubscriptions: Number(subscriptions.activePro || 0),
        activeSubscriptionBillingKrw: Number(subscriptions.activeBillingKrw || 0),
      }}
      salesTrend={salesTrend}
      memberTrend={memberTrend}
    >
      {tab === "billing" ? (
        <AdminBillingDashboard
          orders={orders}
          refunds={refunds}
          initialFilters={{ status, provider, query }}
        />
      ) : tab === "refunds" ? (
        <AdminRefundsDashboard
          refundCases={refundCases}
          metrics={refundCaseMetrics}
          initialFilters={{ status: refundCaseStatus, query }}
        />
      ) : tab === "members" ? (
        <AdminMembersDashboard
          members={members}
          totalCount={filteredMemberCount}
          referralOptions={memberReferralOptionRows.map((row) => ({
            id: row.id,
            creatorName: row.creatorName,
            slug: row.slug,
          }))}
          initialFilters={{ query, memberType, memberPlan, memberActivity, memberReferrer }}
        />
      ) : tab === "managed-accounts" ? (
        <AdminManagedAccountsSection />
      ) : tab === "referrals" ? (
        <AdminReferralsSection />
      ) : tab === "inquiries" ? (
        <AdminInquiriesDashboard
          inquiries={inquiries}
          metrics={inquiryMetrics}
          initialFilters={{
            query,
            status: inquiryStatus,
            category: inquiryCategory,
            kind: inquiryKind,
          }}
        />
      ) : tab === "feedback" ? (
        <AdminFeedbackDashboard
          feedback={feedback}
          metrics={feedbackMetrics}
          reasonCounts={feedbackReasonRows.map((row) => ({
            reason: row.disappointmentReason,
            count: Number(row.count),
          }))}
          query={query}
        />
      ) : tab === "onboarding" ? (
        <AdminOnboardingDashboard
          responses={onboardingResponses}
          metrics={onboardingMetrics}
          occupationCounts={onboardingOccupationCounts}
          usagePurposeCounts={onboardingUsagePurposeCounts}
          query={query}
        />
      ) : tab === "editor-releases" ? (
        <AdminEditorReleases
          masterEnvironmentEnabled={editorRenderingV2MasterEnabled()}
          globalEnvironmentEnabled={editorRenderingV2GlobalEnabled()}
          publicEnabled={Boolean(editorReleaseState?.publicEnabled)}
          canaryEnabled={Boolean(editorReleaseState?.canaryEnabled)}
          stableReleaseId={editorReleaseState?.stableReleaseId
            ? String(editorReleaseState.stableReleaseId)
            : null}
          previousStableReleaseId={editorReleaseState?.previousStableReleaseId
            ? String(editorReleaseState.previousStableReleaseId)
            : null}
          candidateReleaseId={editorReleaseState?.candidateReleaseId
            ? String(editorReleaseState.candidateReleaseId)
            : null}
          releases={editorReleases}
          checks={editorReleaseChecks}
          testers={editorReleaseTesters}
          renderStats={editorReleaseRenderStats}
        />
      ) : tab === "settings" ? (
        <AdminRuntimeSettings
          initialEnabled={Boolean(runtimeSettingRows[0]?.enabled)}
          environmentEnabled={onboardingWelcomeGrantEnabled()}
          initialUpdatedAt={iso(runtimeSettingRows[0]?.updatedAt)}
          initialUpdatedBy={runtimeSettingRows[0]?.updatedByEmail || null}
        />
      ) : (
        <AdminInstallmentsDashboard />
      )}
    </AdminShell>
  );
}
