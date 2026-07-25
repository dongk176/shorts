import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdminUser } from "@/lib/admin";
import { addKstMonths } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createNoIndexMetadata } from "@/lib/seo";
import { AdminBillingDashboard, type AdminOrder, type AdminRefund } from "./admin-billing-dashboard";
import { AdminMembersDashboard, type AdminMember } from "./admin-members-dashboard";
import { AdminInstallmentsDashboard } from "./admin-installments-dashboard";

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
  const tab = ["billing", "members", "installments"].includes(requestedTab)
    ? requestedTab
    : "billing";
  const requestedStatus = first(params.status);
  const requestedProvider = first(params.provider);
  const status = ["pending", "processing", "succeeded", "failed", "unknown", "manual_review", "canceled", "expired"].includes(requestedStatus)
    ? requestedStatus
    : "all";
  const provider = ["nicepay", "thepayone"].includes(requestedProvider) ? requestedProvider : "all";
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
  const db = getDb();
  const metricRows = await db`
      select
        coalesce(sum(amount_krw) filter (where status='succeeded'),0)::bigint as gross_sales,
        coalesce(sum(refunded_amount_krw),0)::bigint as refunded_sales,
        coalesce(sum(amount_krw-refunded_amount_krw) filter (where status='succeeded'),0)::bigint as net_sales,
        coalesce(sum(amount_krw-refunded_amount_krw) filter (
          where status='succeeded'
            and approved_at >= (date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
        ),0)::bigint as today_net_sales,
        count(*) filter (where status='succeeded')::integer as paid_orders,
        count(*) filter (where status in ('unknown','manual_review'))::integer as review_orders
      from shorts_mvp.billing_orders
    `;
  const subscriptionRows = await db`
      select
        count(*) filter (where status='active')::integer as active,
        count(*) filter (where status='past_due')::integer as past_due,
        count(*) filter (where billing_review_status='manual_review')::integer as manual_review
      from shorts_mvp.user_subscriptions
    `;
  const orderRows = tab === "billing" ? await db`
      select o.id,o.order_id,o.kind,o.product_code,o.billing_cycle,o.amount_krw,
        o.refunded_amount_krw,o.refund_status,o.status,o.provider,o.provider_transaction_id,
        o.provider_status,o.failure_code,o.renewal_period_start,o.approved_at,o.created_at,u.email,
        s.status as subscription_status,p.prepaid_months,
        coalesce(ur.reserved_refund_krw,0)::integer as reserved_refund_krw,
        coalesce(pfu.usage_count,0)::integer as popular_filter_usage_count,
        pfu.last_used_at as popular_filter_last_used_at
      from shorts_mvp.billing_orders o
      join shorts_mvp.app_users u on u.id=o.user_id
      left join shorts_mvp.user_subscriptions s on s.id=o.subscription_id
      left join shorts_mvp.plans p on p.code=o.product_code
      left join (
        select source_order_id, sum(refund_amount_krw)::integer as reserved_refund_krw
        from shorts_mvp.subscription_upgrade_refunds
        where status in ('pending','submitted','manual_review')
        group by source_order_id
      ) ur on ur.source_order_id=o.id
      left join lateral (
        select count(*)::integer as usage_count,max(occurred_at) as last_used_at
        from shorts_mvp.popular_filter_usage_events
        where billing_order_id=o.id
      ) pfu on true
      where (${status}='all' or o.status=${status})
        and (${provider}='all' or o.provider=${provider})
        and (
          ${query}=''
          or lower(coalesce(u.email,'')) like ${`%${query.toLowerCase()}%`}
          or lower(o.order_id) like ${`%${query.toLowerCase()}%`}
          or lower(coalesce(o.provider_transaction_id,'')) like ${`%${query.toLowerCase()}%`}
        )
      order by o.created_at desc
      limit 100
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
  const memberRows = tab === "members" ? await db`
      select
        u.id,u.email,u.display_name,u.created_at,u.last_sign_in_at,
        s.id as subscription_id,s.plan_code,s.billing_cycle,s.status as subscription_status,
        s.current_period_start,s.current_period_end,s.next_charge_at,
        s.provider_schedule_status,s.billing_review_status,s.billing_review_reason,
        s.payment_provider,m.issuer_name,m.card_number_masked,
        coalesce(projects.project_count,0)::integer as project_count,
        coalesce(shorts.short_count,0)::integer as short_count
      from shorts_mvp.app_users u
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
      order by coalesce(u.last_sign_in_at,u.created_at) desc
      limit 100
    ` : [];

  const metrics = metricRows[0] || {};
  const subscriptions = subscriptionRows[0] || {};
  const orders: AdminOrder[] = orderRows.map((row) => {
    const contractStart = row.renewalPeriodStart instanceof Date
      ? row.renewalPeriodStart
      : row.approvedAt instanceof Date
        ? row.approvedAt
        : null;
    const contractMonths = row.billingCycle === "yearly" ? Number(row.prepaidMonths || 12) : 1;
    return {
      id: row.id,
      orderId: row.orderId,
      kind: row.kind,
      productCode: row.productCode,
      billingCycle: row.billingCycle || null,
      amountKrw: Number(row.amountKrw),
      refundedAmountKrw: Number(row.refundedAmountKrw || 0),
      reservedRefundKrw: Number(row.reservedRefundKrw || 0),
      refundStatus: row.refundStatus,
      status: row.status,
      provider: row.provider,
      providerTransactionId: row.providerTransactionId || null,
      providerStatus: row.providerStatus || null,
      failureCode: row.failureCode || null,
      approvedAt: iso(row.approvedAt),
      createdAt: iso(row.createdAt)!,
      email: row.email || "-",
      subscriptionStatus: row.subscriptionStatus || null,
      contractPeriodStart: iso(contractStart),
      contractPeriodEnd: contractStart ? addKstMonths(contractStart, contractMonths).toISOString() : null,
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
  }));

  return (
    <main className="min-h-screen bg-[#0d0f10] text-neutral-100">
      <header className="border-b border-white/10 bg-[#111415]/95">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.22em] text-[#ff9585]">Easy Cut Admin</p>
            <h1 className="mt-1 text-xl font-black">운영 관리</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-neutral-400">
            <span className="hidden sm:inline">{admin.email}</span>
            <Link href="/" className="rounded-xl border border-white/10 px-4 py-2 font-bold text-neutral-200 transition hover:bg-white/[.06]">서비스로 이동</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-5 py-7 sm:px-8">
        <nav className="mb-6 flex gap-2" aria-label="관리자 메뉴">
          <Link
            href="/admin/easycutcutcutcutcutcut?tab=billing"
            aria-current={tab === "billing" ? "page" : undefined}
            className={`rounded-xl px-5 py-2.5 text-sm font-black transition ${tab === "billing" ? "bg-white text-black" : "border border-white/10 text-neutral-400 hover:bg-white/[.05] hover:text-white"}`}
          >
            결제
          </Link>
          <Link
            href="/admin/easycutcutcutcutcutcut?tab=members"
            aria-current={tab === "members" ? "page" : undefined}
            className={`rounded-xl px-5 py-2.5 text-sm font-black transition ${tab === "members" ? "bg-white text-black" : "border border-white/10 text-neutral-400 hover:bg-white/[.05] hover:text-white"}`}
          >
            회원
          </Link>
          <Link
            href="/admin/easycutcutcutcutcutcut?tab=installments"
            aria-current={tab === "installments" ? "page" : undefined}
            className={`rounded-xl px-5 py-2.5 text-sm font-black transition ${tab === "installments" ? "bg-white text-black" : "border border-white/10 text-neutral-400 hover:bg-white/[.05] hover:text-white"}`}
          >
            할부 혜택
          </Link>
        </nav>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="결제 요약">
          {[
            ["누적 총매출", Number(metrics.grossSales || 0), "money"],
            ["누적 환불", Number(metrics.refundedSales || 0), "money"],
            ["누적 순매출", Number(metrics.netSales || 0), "money"],
            ["오늘 순매출", Number(metrics.todayNetSales || 0), "money"],
            ["활성 구독", Number(subscriptions.active || 0), "count"],
            ["확인 필요", Number(metrics.reviewOrders || 0) + Number(subscriptions.manualReview || 0), "count"],
          ].map(([label, value, kind]) => (
            <article key={String(label)} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5 shadow-[0_16px_50px_rgba(0,0,0,.18)]">
              <p className="text-xs font-bold text-neutral-500">{label}</p>
              <p className="mt-3 text-2xl font-black tracking-tight text-white">
                {kind === "money" ? `${Number(value).toLocaleString("ko-KR")}원` : `${Number(value).toLocaleString("ko-KR")}건`}
              </p>
            </article>
          ))}
        </section>

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-neutral-400">
          <span className="rounded-full bg-white/[.05] px-3 py-1.5">승인 주문 {Number(metrics.paidOrders || 0).toLocaleString("ko-KR")}건</span>
          <span className="rounded-full bg-white/[.05] px-3 py-1.5">연체 구독 {Number(subscriptions.pastDue || 0).toLocaleString("ko-KR")}건</span>
        </div>

        {tab === "billing" ? (
          <AdminBillingDashboard
            orders={orders}
            refunds={refunds}
            initialFilters={{ status, provider, query }}
          />
        ) : tab === "members" ? (
          <AdminMembersDashboard
            members={members}
            initialFilters={{ query, memberType, memberPlan, memberActivity }}
          />
        ) : (
          <AdminInstallmentsDashboard />
        )}
      </div>
    </main>
  );
}
