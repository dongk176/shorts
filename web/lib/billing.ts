import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type {
  BillingCycle,
  BillingSummary,
  PaidPlanCode,
  PlanCode,
  SubscriptionStatus,
} from "@/lib/contracts";
import { resolveStoredCardIssuer } from "@/lib/billing-card";
import { HttpError } from "@/lib/http";
import { isPricingV2PackageCode } from "@/lib/pricing-v2";

export type BillingDb = Sql | TransactionSql;

export type PaidPlanProduct = {
  code: PaidPlanCode;
  displayName: string;
  monthlySourceSeconds: number;
  retentionDays: number;
  monthlyPriceKrw: number;
  yearlyPriceKrw: number;
  maxActiveJobs: number;
  prepaidMonths: number;
};

export type AddonProduct = {
  code: string;
  displayName: string;
  seconds: number;
  priceKrw: number;
  validityDays: number;
};

export function createBillingOrderId(prefix: "SUB" | "REN" | "ADD" | "PM") {
  return `EC-${prefix}-${randomUUID().replaceAll("-", "")}`;
}

export function addKstMonths(date: Date, months: number, anchorDay?: number) {
  const offset = 9 * 60 * 60 * 1000;
  const kst = new Date(date.getTime() + offset);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + months;
  const day = anchorDay && anchorDay >= 1 && anchorDay <= 31
    ? anchorDay
    : kst.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const shifted = new Date(Date.UTC(
    year,
    month,
    Math.min(day, lastDay),
    kst.getUTCHours(),
    kst.getUTCMinutes(),
    kst.getUTCSeconds(),
    kst.getUTCMilliseconds(),
  ));
  return new Date(shifted.getTime() - offset);
}

export function extendMonthlyEntitlement(
  currentEntitlementEnd: Date,
  paidAt: Date,
  billingAnchorDay?: number,
) {
  const entitlementTail = currentEntitlementEnd > paidAt
    ? currentEntitlementEnd
    : paidAt;
  return addKstMonths(entitlementTail, 1, billingAnchorDay);
}

export function nextMonthlyChargeAfterResume(
  scheduledChargeAt: Date,
  resumedAt: Date,
  billingAnchorDay?: number,
) {
  let nextChargeAt = scheduledChargeAt;
  for (let month = 0; month < 120 && nextChargeAt <= resumedAt; month += 1) {
    nextChargeAt = addKstMonths(nextChargeAt, 1, billingAnchorDay);
  }
  if (nextChargeAt <= resumedAt) {
    throw new Error("다음 자동결제일을 계산하지 못했습니다.");
  }
  return nextChargeAt;
}

export async function getPaidPlan(db: BillingDb, code: string): Promise<PaidPlanProduct> {
  const rows = await db`
    select code,display_name,monthly_source_seconds,retention_days,
      monthly_price_krw,yearly_price_krw,max_active_jobs,prepaid_months
    from shorts_mvp.plans
    where code=${code} and code <> 'free' and is_active
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new HttpError(404, "선택한 플랜을 찾을 수 없습니다.");
  return {
    code: row.code as PaidPlanCode,
    displayName: row.displayName,
    monthlySourceSeconds: Number(row.monthlySourceSeconds),
    retentionDays: Number(row.retentionDays),
    monthlyPriceKrw: Number(row.monthlyPriceKrw),
    yearlyPriceKrw: Number(row.yearlyPriceKrw),
    maxActiveJobs: Number(row.maxActiveJobs),
    prepaidMonths: Number(row.prepaidMonths || 12),
  };
}

export async function getAddonProduct(db: BillingDb, code: string): Promise<AddonProduct> {
  const rows = await db`
    select code,display_name,seconds,price_krw,validity_days
    from shorts_mvp.addon_products where code=${code} and is_active limit 1
  `;
  const row = rows[0];
  if (!row) throw new HttpError(404, "선택한 추가 시간 상품을 찾을 수 없습니다.");
  return {
    code: row.code,
    displayName: row.displayName,
    seconds: Number(row.seconds),
    priceKrw: Number(row.priceKrw),
    validityDays: Number(row.validityDays),
  };
}

export async function assertPricingV2PackagePurchaseAvailable(
  db: BillingDb,
  userId: string,
  planCode: string,
  excludeRequestId?: string,
) {
  if (!isPricingV2PackageCode(planCode)) return;
  await db`
    update shorts_mvp.billing_orders
    set status='expired'
    where user_id=${userId} and product_code=${planCode}
      and status='pending' and checkout_expires_at<=clock_timestamp()
  `;
  const rows = excludeRequestId
    ? await db`
        select id from shorts_mvp.billing_orders
        where user_id=${userId} and product_code=${planCode}
          and status in ('pending','processing','succeeded','manual_review')
          and request_id<>${excludeRequestId}
        limit 1
      `
    : await db`
        select id from shorts_mvp.billing_orders
        where user_id=${userId} and product_code=${planCode}
          and status in ('pending','processing','succeeded','manual_review')
        limit 1
      `;
  if (rows[0]) {
    throw new HttpError(
      409,
      "이 패키지 상품은 계정당 한 번만 구매할 수 있습니다.",
      "PACKAGE_ALREADY_PURCHASED",
    );
  }
}

export async function syncCachedPlan(db: BillingDb, userId: string, planCode: PlanCode) {
  await db`update shorts_mvp.app_users set selected_plan_code=${planCode} where id=${userId}`;
  await db`update shorts_mvp.mvp_sessions set selected_plan_code=${planCode} where user_id=${userId}`;
}

export async function createBaseUsageGrant(input: {
  db: BillingDb;
  userId: string;
  subscriptionId: string;
  billingOrderId: string;
  plan: PaidPlanProduct;
  validFrom: Date;
  subscriptionEnd: Date;
  billingAnchorDay?: number;
  totalSeconds?: number;
  creditedSeconds?: number;
  carriedSeconds?: number;
  carryUntilSubscriptionEnd?: boolean;
}) {
  const monthlyEnd = addKstMonths(input.validFrom, 1, input.billingAnchorDay);
  const expiresAt = input.carryUntilSubscriptionEnd
    ? input.subscriptionEnd
    : monthlyEnd < input.subscriptionEnd
      ? monthlyEnd
      : input.subscriptionEnd;
  const totalSeconds = input.totalSeconds ?? input.plan.monthlySourceSeconds;
  const carriedSeconds = input.carriedSeconds ?? 0;
  const creditedSeconds = input.creditedSeconds ?? totalSeconds - carriedSeconds;
  if (!Number.isSafeInteger(totalSeconds) || totalSeconds < 0) {
    throw new Error("기본 사용량이 올바르지 않습니다.");
  }
  if (
    !Number.isSafeInteger(creditedSeconds)
    || !Number.isSafeInteger(carriedSeconds)
    || creditedSeconds < 0
    || carriedSeconds < 0
    || creditedSeconds + carriedSeconds !== totalSeconds
  ) {
    throw new Error("기본 사용량의 지급·이월 구성이 올바르지 않습니다.");
  }
  if (totalSeconds === 0) return expiresAt;
  await input.db`
    insert into shorts_mvp.usage_grants (
      user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,
      credited_seconds,carried_seconds,valid_from,expires_at
    ) values (
      ${input.userId},${input.subscriptionId},${input.billingOrderId},'base',${input.plan.code},
      ${totalSeconds},${creditedSeconds},${carriedSeconds},${input.validFrom},${expiresAt}
    )
    on conflict (subscription_id,valid_from,kind) where subscription_id is not null and kind='base'
    do nothing
  `;
  return monthlyEnd < input.subscriptionEnd ? monthlyEnd : input.subscriptionEnd;
}

export async function getBillingSummary(db: BillingDb, userId: string | null): Promise<BillingSummary> {
  if (!userId) {
    return {
      hasPaymentHistory: false,
      lastPaidPlanCode: null,
      lastPaidBillingCycle: null,
      lastPaidAt: null,
      purchasedPackageCodes: [],
      activeProducts: [],
      status: "none",
      planCode: "free",
      billingCycle: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextChargeAt: null,
      cancelAtPeriodEnd: false,
      scheduledPlanCode: null,
      scheduledBillingCycle: null,
      cardIssuer: null,
      cardNumberMasked: null,
      cardLast4: null,
      hasStoredPayerTel: false,
      paymentProvider: null,
      providerScheduleStatus: "none",
      requiresManualReview: false,
      canCreateJobs: false,
      maxActiveJobs: 0,
      retentionDays: 1,
    };
  }
  const historyRows = await db`
    select
      exists (
        select 1 from shorts_mvp.billing_orders
        where user_id=${userId} and status='succeeded' and amount_krw > 0
      ) as has_payment_history,
      coalesce((
        select array_agg(distinct package_order.product_code order by package_order.product_code)
        from shorts_mvp.billing_orders package_order
        where package_order.user_id=${userId}
          and package_order.product_code in (
            'starter_3m','starter_6m','starter_12m',
            'expert_3m','expert_6m','expert_12m'
          )
          and (
            package_order.status in ('processing','succeeded','manual_review')
            or (
              package_order.status='pending'
              and package_order.checkout_expires_at>clock_timestamp()
            )
          )
      ),array[]::text[]) as purchased_package_codes,
      last_paid.product_code,last_paid.billing_cycle,last_paid.approved_at,
      default_method.provider as default_payment_provider,
      default_method.issuer_name as default_issuer_name,
      default_method.issuer_code as default_issuer_code,
      default_method.card_number_masked as default_card_number_masked,
      default_method.card_last4 as default_card_last4,
      (
        default_method.payer_tel_ciphertext is not null
        and default_method.payer_tel_iv is not null
        and default_method.payer_tel_tag is not null
      ) as default_has_stored_payer_tel,
      account.manual_service_access_until > clock_timestamp()
        as has_manual_service_access
    from shorts_mvp.app_users account
    left join shorts_mvp.billing_payment_methods default_method
      on default_method.id=account.default_payment_method_id
     and default_method.user_id=account.id
     and default_method.status not in ('disposed','manual_review','replaced','revoked')
    left join lateral (
      select product_code,billing_cycle,approved_at
      from shorts_mvp.billing_orders
      where user_id=${userId} and status='succeeded' and amount_krw > 0
        and billing_cycle in ('monthly','yearly')
        and product_code in (
          'plus','standard','pro','easycut_pro_v2',
          'starter_3m','starter_6m','starter_12m',
          'expert_3m','expert_6m','expert_12m'
        )
      order by approved_at desc nulls last,created_at desc
      limit 1
    ) last_paid on true
    where account.id=${userId}
  `;
  const history = historyRows[0];
  const rows = await db`
    select s.status,s.plan_code,s.billing_cycle,s.current_period_start,s.current_period_end,
      coalesce(s.next_retry_at,s.next_charge_at) as next_charge_at,
      s.cancel_at_period_end,s.scheduled_plan_code,s.scheduled_billing_cycle,
      s.payment_provider,s.provider_schedule_status,s.billing_review_status,
      m.issuer_name,m.issuer_code,m.card_number_masked,m.card_last4,
      (m.payer_tel_ciphertext is not null and m.payer_tel_iv is not null and m.payer_tel_tag is not null)
        as has_stored_payer_tel,
      p.display_name,p.monthly_source_seconds,p.max_active_jobs,p.retention_days
    from shorts_mvp.user_subscriptions s
    join shorts_mvp.plans p on p.code=s.plan_code
    left join shorts_mvp.billing_payment_methods m on m.id=s.payment_method_id
    where s.user_id=${userId} and s.status in ('pending','trialing','active','past_due')
    order by p.max_active_jobs desc,p.retention_days desc,s.created_at desc
  `;
  const row = rows[0];
  if (!row) {
    const empty = await getBillingSummary(db, null);
    return {
      ...empty,
      hasPaymentHistory: Boolean(history?.hasPaymentHistory),
      lastPaidPlanCode: (history?.productCode as PaidPlanCode | undefined) || null,
      lastPaidBillingCycle: (history?.billingCycle as BillingCycle | undefined) || null,
      lastPaidAt: history?.approvedAt?.toISOString?.() || null,
      purchasedPackageCodes: Array.isArray(history?.purchasedPackageCodes)
        ? history.purchasedPackageCodes.filter(isPricingV2PackageCode) as PaidPlanCode[]
        : [],
      cardIssuer: resolveStoredCardIssuer({
        issuer: history?.defaultIssuerName || history?.defaultIssuerCode || null,
        cardNumberMasked: history?.defaultCardNumberMasked || null,
      }),
      cardNumberMasked: history?.defaultCardNumberMasked || null,
      cardLast4: history?.defaultCardLast4 || null,
      hasStoredPayerTel: Boolean(history?.defaultHasStoredPayerTel),
      paymentProvider: history?.defaultPaymentProvider || null,
      canCreateJobs: Boolean(history?.hasManualServiceAccess),
      maxActiveJobs: history?.hasManualServiceAccess ? 1 : 0,
      retentionDays: history?.hasManualServiceAccess ? 30 : 1,
    };
  }
  const status = row.status === "trialing" ? "active" : row.status as SubscriptionStatus;
  const planCode = row.planCode as PlanCode;
  const now = Date.now();
  const inCurrentPeriod = row.currentPeriodStart instanceof Date
    && row.currentPeriodEnd instanceof Date
    && row.currentPeriodStart.getTime() <= now
    && row.currentPeriodEnd.getTime() > now;
  const activeProducts = rows.flatMap((activeRow) => {
    const isActiveStatus = activeRow.status === "active" || activeRow.status === "trialing";
    const isActivePeriod = activeRow.currentPeriodStart instanceof Date
      && activeRow.currentPeriodEnd instanceof Date
      && activeRow.currentPeriodStart.getTime() <= now
      && activeRow.currentPeriodEnd.getTime() > now;
    if (!isActiveStatus || !isActivePeriod || !activeRow.billingCycle) return [];
    return [{
      planCode: activeRow.planCode as PaidPlanCode,
      displayName: activeRow.displayName || activeRow.planCode,
      billingCycle: activeRow.billingCycle as BillingCycle,
      currentPeriodStart: activeRow.currentPeriodStart.toISOString(),
      currentPeriodEnd: activeRow.currentPeriodEnd.toISOString(),
      nextChargeAt: activeRow.nextChargeAt?.toISOString() || null,
      cancelAtPeriodEnd: Boolean(activeRow.cancelAtPeriodEnd),
      monthlySourceSeconds: Number(activeRow.monthlySourceSeconds),
    }];
  });
  return {
    hasPaymentHistory: Boolean(history?.hasPaymentHistory),
    lastPaidPlanCode: (history?.productCode as PaidPlanCode | undefined) || null,
    lastPaidBillingCycle: (history?.billingCycle as BillingCycle | undefined) || null,
    lastPaidAt: history?.approvedAt?.toISOString?.() || null,
    purchasedPackageCodes: Array.isArray(history?.purchasedPackageCodes)
      ? history.purchasedPackageCodes.filter(isPricingV2PackageCode) as PaidPlanCode[]
      : [],
    activeProducts,
    status,
    planCode,
    billingCycle: row.billingCycle as BillingCycle | null,
    currentPeriodStart: row.currentPeriodStart?.toISOString() || null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() || null,
    nextChargeAt: row.nextChargeAt?.toISOString() || null,
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    scheduledPlanCode: row.scheduledPlanCode as PaidPlanCode | null,
    scheduledBillingCycle: row.scheduledBillingCycle as BillingCycle | null,
    cardIssuer: resolveStoredCardIssuer({
      issuer: history?.defaultIssuerName
        || history?.defaultIssuerCode
        || row.issuerName
        || row.issuerCode
        || null,
      cardNumberMasked: history?.defaultCardNumberMasked || row.cardNumberMasked || null,
    }),
    cardNumberMasked: history?.defaultCardNumberMasked || row.cardNumberMasked || null,
    cardLast4: history?.defaultCardLast4 || row.cardLast4 || null,
    hasStoredPayerTel: history?.defaultPaymentProvider
      ? Boolean(history.defaultHasStoredPayerTel)
      : Boolean(row.hasStoredPayerTel),
    paymentProvider: history?.defaultPaymentProvider || row.paymentProvider || null,
    providerScheduleStatus: row.providerScheduleStatus || "none",
    requiresManualReview: row.billingReviewStatus === "manual_review",
    canCreateJobs: status === "active" && inCurrentPeriod,
    maxActiveJobs: Number(row.maxActiveJobs),
    retentionDays: Number(row.retentionDays),
  };
}

export async function requireActiveSubscription(db: BillingDb, userId: string) {
  const rows = await db`
    select s.*,p.display_name,p.monthly_source_seconds,p.retention_days,
      p.monthly_price_krw,p.yearly_price_krw,p.max_active_jobs
    from shorts_mvp.user_subscriptions s
    join shorts_mvp.plans p on p.code=s.plan_code
    where s.user_id=${userId} and s.status='active'
      and s.current_period_start <= clock_timestamp()
      and s.current_period_end > clock_timestamp()
    order by p.max_active_jobs desc,p.retention_days desc,s.created_at desc limit 1
  `;
  if (!rows[0]) throw new HttpError(402, "활성 구독이 필요합니다.");
  return rows[0];
}
