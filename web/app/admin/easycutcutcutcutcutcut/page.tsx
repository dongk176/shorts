import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/admin";
import { loadAdminBillingOrders } from "@/lib/admin-billing-orders";
import { loadAdminMembers } from "@/lib/admin-members";
import { loadAdminOverview } from "@/lib/admin-overview";
import { ensureAdminDbReady, getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createNoIndexMetadata } from "@/lib/seo";
import { AdminBillingDashboard, type AdminRefund } from "./admin-billing-dashboard";
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
import { AdminMembersDashboard } from "./admin-members-dashboard";
import { AdminManagedAccountsSection } from "./admin-managed-accounts-section";
import { AdminInstallmentsDashboard } from "./admin-installments-dashboard";
import { AdminRuntimeSettings } from "./admin-runtime-settings";
import { AdminShortsEventSetting } from "./admin-shorts-event-setting";
import {
  AdminShell,
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
  onboardingWelcomeGrantEnabled,
} from "@/lib/onboarding-welcome";
import {
  userDiscoverySourceValues,
  userOccupationValues,
  userUsagePurposeValues,
  type UserDiscoverySource,
  type UserOccupation,
  type UserUsagePurpose,
} from "@/lib/user-onboarding";
import {
  SHORTS_THANK_YOU_EVENT_FLAG_KEY,
  shortsThankYouEventEnabled,
} from "@/lib/shorts-thank-you-event";

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
  await ensureAdminDbReady();

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
    eventRuntimeSettingRows,
    overview,
  ] = await Promise.all([
    tab === "settings" ? db`
        select feature_flag.enabled,feature_flag.updated_at,administrator.email as updated_by_email
        from shorts_mvp.runtime_feature_flags feature_flag
        left join shorts_mvp.app_users administrator
          on administrator.id=feature_flag.updated_by_user_id
        where feature_flag.flag_key=${LOGIN_WELCOME_GRANT_FLAG_KEY}
        limit 1
      ` : Promise.resolve([]),
    tab === "settings" ? db`
        select feature_flag.enabled,feature_flag.updated_at,
          administrator.email as updated_by_email
        from shorts_mvp.runtime_feature_flags feature_flag
        left join shorts_mvp.app_users administrator
          on administrator.id=feature_flag.updated_by_user_id
        where feature_flag.flag_key=${SHORTS_THANK_YOU_EVENT_FLAG_KEY}
        limit 1
      ` : Promise.resolve([]),
    loadAdminOverview(),
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
            candidate_release_id,public_enabled,canary_enabled,
            coalesce((
              select count(*)=4
              from shorts_mvp.runtime_feature_flags
              where enabled=true and flag_key in (
                'editor_subtitle_editing_public',
                'elevenlabs_transcription_public',
                'subtitle_templates_public',
                'elevenlabs_public_compliance_approved'
              )
            ),false) as subtitle_suite_public_enabled
          from shorts_mvp.editor_release_state
          where singleton=true
          limit 1
        `,
        db`
          select id,git_sha,ui_version,document_version,
            worker_image_digest,production_job_definition_arn,status,
            subtitle_editing_capable,
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
          select tester.user_id,tester_user.email,tester_user.display_name,
            tester.enabled,tester.updated_at
          from shorts_mvp.editor_release_testers tester
          join shorts_mvp.app_users tester_user on tester_user.id=tester.user_id
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
  const [orderPage, refundRows, remediationMetricRows] = tab === "billing"
    ? await Promise.all([
        loadAdminBillingOrders({
          filters: { status, provider, query },
        }),
        db`
          select r.id,r.billing_order_id,r.amount_krw,r.reason,r.status,
            r.entitlement_action_status,r.provider_refund_transaction_id,r.failure_message,
            r.requested_at,r.processed_at,o.order_id,u.email,a.email as admin_email
          from shorts_mvp.admin_billing_refunds r
          join shorts_mvp.billing_orders o on o.id=r.billing_order_id
          join shorts_mvp.app_users u on u.id=o.user_id
          join shorts_mvp.app_users a on a.id=r.requested_by_user_id
          order by r.requested_at desc
          limit 50
        `,
        db`
          select
            count(*)::integer as total,
            count(*) filter (where r.state='required')::integer as required,
            count(*) filter (where r.state='registering')::integer as registering,
            count(*) filter (where r.state='awaiting_provider')::integer as awaiting_provider,
            count(*) filter (where r.state='completed')::integer as completed,
            count(*) filter (where r.state='expired')::integer as expired,
            count(*) filter (where r.state='manual_review')::integer as manual_review,
            count(*) filter (
              where r.state='registering'
                and r.claim_started_at<clock_timestamp()-interval '2 minutes'
            )::integer as stale_registering,
            count(*) filter (
              where r.state in ('required','registering','awaiting_provider')
                and (
                  s.current_period_end<>r.original_current_period_end
                  or s.next_charge_at<>r.original_next_charge_at
                  or s.billing_anchor_day<>r.billing_anchor_day
                )
            )::integer as snapshot_changed,
            count(*) filter (
              where legacy.provider_schedule_status='active'
                and replacement.provider_schedule_status='active'
            )::integer as duplicate_active_schedules,
            coalesce((
              select enabled from shorts_mvp.runtime_feature_flags
              where flag_key='legacy_recurring_card_claims'
            ),false) as claims_enabled,
            coalesce((
              select enabled from shorts_mvp.runtime_feature_flags
              where flag_key='legacy_recurring_card_reconciliation'
            ),false) as reconciliation_enabled
          from shorts_mvp.billing_payment_method_remediations r
          join shorts_mvp.user_subscriptions s on s.id=r.subscription_id
          join shorts_mvp.billing_payment_methods legacy on legacy.id=r.legacy_payment_method_id
          left join shorts_mvp.billing_payment_methods replacement on replacement.id=r.new_payment_method_id
          where r.campaign_key='legacy_easycut_pro_202608'
        `,
      ])
    : [{ orders: [], hasMore: false, nextOffset: 0 }, [], []];
  const [refundCaseRows, refundCaseMetricRows] = tab === "refunds"
    ? await Promise.all([
        db`
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
        `,
        db`
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
        `,
      ])
    : [[], []];
  const [memberPage, memberReferralOptionRows] = tab === "members"
    ? await Promise.all([
        loadAdminMembers({
          filters: {
            query,
            memberType,
            memberPlan,
            memberActivity,
            memberReferrer,
          },
        }),
        db`
          select id,creator_name,slug
          from shorts_mvp.referral_partners
          order by creator_name,slug
        `,
      ])
    : [{ members: [], totalCount: 0, hasMore: false, nextOffset: 0 }, []];
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
        p.usage_purpose_other,p.discovery_source,p.discovery_source_other,
        p.onboarding_version,p.completed_at,
        u.email,u.display_name
      from shorts_mvp.user_onboarding_profiles p
      join shorts_mvp.app_users u on u.id=p.user_id
      where (
        ${query}=''
        or lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(u.display_name,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(p.occupation_other,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(p.usage_purpose_other,'')) like ${`%${query.toLowerCase()}%`}
        or lower(coalesce(p.discovery_source_other,'')) like ${`%${query.toLowerCase()}%`}
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
  const onboardingDiscoverySourceCountRows = tab === "onboarding" ? await db`
      select discovery_source,count(*)::integer as count
      from shorts_mvp.user_onboarding_profiles
      where discovery_source is not null
      group by discovery_source
      order by count desc,discovery_source
    ` : [];

  const orders = orderPage.orders;
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
  const validDiscoverySources = new Set<string>(userDiscoverySourceValues);
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
      discoverySource: validDiscoverySources.has(String(row.discoverySource))
        ? row.discoverySource as UserDiscoverySource
        : null,
      discoverySourceOther: row.discoverySourceOther || null,
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
  const onboardingDiscoverySourceCounts = onboardingDiscoverySourceCountRows
    .filter((row) => validDiscoverySources.has(String(row.discoverySource)))
    .map((row) => ({
      discoverySource: row.discoverySource as UserDiscoverySource,
      count: Number(row.count || 0),
    }));
  const editorReleaseState = editorReleaseStateRows[0];
  const editorReleases: AdminEditorRelease[] = editorReleaseRows.map((row) => ({
    id: String(row.id),
    gitSha: String(row.gitSha),
    uiVersion: Number(row.uiVersion),
    documentVersion: Number(row.documentVersion),
    subtitleEditingCapable: Boolean(row.subtitleEditingCapable),
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
      metrics={overview.metrics}
      salesTrend={overview.salesTrend}
      memberTrend={overview.memberTrend}
    >
      {tab === "billing" ? (
        <AdminBillingDashboard
          orders={orders}
          refunds={refunds}
          initialFilters={{ status, provider, query }}
          initialHasMore={orderPage.hasMore}
          initialNextOffset={orderPage.nextOffset}
          remediationMetrics={remediationMetricRows[0] ? {
            total: Number(remediationMetricRows[0].total || 0),
            required: Number(remediationMetricRows[0].required || 0),
            registering: Number(remediationMetricRows[0].registering || 0),
            awaitingProvider: Number(remediationMetricRows[0].awaitingProvider || 0),
            completed: Number(remediationMetricRows[0].completed || 0),
            expired: Number(remediationMetricRows[0].expired || 0),
            manualReview: Number(remediationMetricRows[0].manualReview || 0),
            staleRegistering: Number(remediationMetricRows[0].staleRegistering || 0),
            snapshotChanged: Number(remediationMetricRows[0].snapshotChanged || 0),
            duplicateActiveSchedules: Number(remediationMetricRows[0].duplicateActiveSchedules || 0),
            claimsEnabled: Boolean(remediationMetricRows[0].claimsEnabled),
            reconciliationEnabled: Boolean(remediationMetricRows[0].reconciliationEnabled),
          } : null}
        />
      ) : tab === "refunds" ? (
        <AdminRefundsDashboard
          refundCases={refundCases}
          metrics={refundCaseMetrics}
          initialFilters={{ status: refundCaseStatus, query }}
        />
      ) : tab === "members" ? (
        <AdminMembersDashboard
          members={memberPage.members}
          totalCount={memberPage.totalCount}
          initialHasMore={memberPage.hasMore}
          initialNextOffset={memberPage.nextOffset}
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
          discoverySourceCounts={onboardingDiscoverySourceCounts}
          query={query}
        />
      ) : tab === "editor-releases" ? (
        <AdminEditorReleases
          masterEnvironmentEnabled={editorRenderingV2MasterEnabled()}
          globalEnvironmentEnabled={editorRenderingV2GlobalEnabled()}
          publicEnabled={Boolean(editorReleaseState?.publicEnabled)}
          canaryEnabled={Boolean(editorReleaseState?.canaryEnabled)}
          subtitleSuitePublicEnabled={Boolean(
            editorReleaseState?.subtitleSuitePublicEnabled,
          )}
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
        <>
          <AdminRuntimeSettings
            initialEnabled={Boolean(runtimeSettingRows[0]?.enabled)}
            environmentEnabled={onboardingWelcomeGrantEnabled()}
            initialUpdatedAt={iso(runtimeSettingRows[0]?.updatedAt)}
            initialUpdatedBy={runtimeSettingRows[0]?.updatedByEmail || null}
          />
          <AdminShortsEventSetting
            initialEnabled={Boolean(eventRuntimeSettingRows[0]?.enabled)}
            environmentEnabled={shortsThankYouEventEnabled()}
            initialUpdatedAt={iso(eventRuntimeSettingRows[0]?.updatedAt)}
            initialUpdatedBy={eventRuntimeSettingRows[0]?.updatedByEmail || null}
          />
        </>
      ) : (
        <AdminInstallmentsDashboard />
      )}
    </AdminShell>
  );
}
