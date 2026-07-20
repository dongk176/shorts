import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type {
  BillingCycle,
  BillingSummary,
  PaidPlanCode,
  PlanCode,
  SubscriptionStatus,
} from "@/lib/contracts";
import { HttpError } from "@/lib/http";

export type BillingDb = Sql | TransactionSql;

export type PaidPlanProduct = {
  code: PaidPlanCode;
  displayName: string;
  monthlySourceSeconds: number;
  retentionDays: number;
  monthlyPriceKrw: number;
  yearlyPriceKrw: number;
  maxActiveJobs: number;
};

export type AddonProduct = {
  code: string;
  displayName: string;
  seconds: number;
  priceKrw: number;
  validityDays: number;
};

export function createProviderOrderId(prefix: "SUB" | "REN" | "ADD" | "PM") {
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

export async function getPaidPlan(db: BillingDb, code: string): Promise<PaidPlanProduct> {
  const rows = await db`
    select code,display_name,monthly_source_seconds,retention_days,
      monthly_price_krw,yearly_price_krw,max_active_jobs
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

export async function ensureTossCustomerKey(db: BillingDb, userId: string) {
  const value = `EC${randomUUID().replaceAll("-", "")}`;
  const rows = await db`
    update shorts_mvp.app_users
    set toss_customer_key=coalesce(toss_customer_key,${value})
    where id=${userId}
    returning toss_customer_key
  `;
  if (!rows[0]?.tossCustomerKey) throw new HttpError(404, "결제 고객 정보를 찾을 수 없습니다.");
  return String(rows[0].tossCustomerKey);
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
}) {
  const monthlyEnd = addKstMonths(input.validFrom, 1, input.billingAnchorDay);
  const expiresAt = monthlyEnd < input.subscriptionEnd ? monthlyEnd : input.subscriptionEnd;
  await input.db`
    insert into shorts_mvp.usage_grants (
      user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,valid_from,expires_at
    ) values (
      ${input.userId},${input.subscriptionId},${input.billingOrderId},'base',${input.plan.code},
      ${input.plan.monthlySourceSeconds},${input.validFrom},${expiresAt}
    )
    on conflict (subscription_id,valid_from,kind) where subscription_id is not null and kind='base'
    do nothing
  `;
  return expiresAt;
}

export async function getBillingSummary(db: BillingDb, userId: string | null): Promise<BillingSummary> {
  if (!userId) {
    return {
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
      canCreateJobs: false,
      maxActiveJobs: 0,
      retentionDays: 1,
    };
  }
  const rows = await db`
    select s.status,s.plan_code,s.billing_cycle,s.current_period_start,s.current_period_end,
      coalesce(s.next_retry_at,s.next_charge_at) as next_charge_at,
      s.cancel_at_period_end,s.scheduled_plan_code,s.scheduled_billing_cycle,
      m.issuer_name,m.issuer_code,m.card_number_masked,m.card_last4,p.max_active_jobs,p.retention_days
    from shorts_mvp.user_subscriptions s
    join shorts_mvp.plans p on p.code=s.plan_code
    left join shorts_mvp.billing_payment_methods m on m.id=s.payment_method_id
    where s.user_id=${userId} and s.status in ('pending','trialing','active','past_due')
    order by s.created_at desc limit 1
  `;
  const row = rows[0];
  if (!row) return getBillingSummary(db, null);
  const status = row.status === "trialing" ? "active" : row.status as SubscriptionStatus;
  const planCode = row.planCode as PlanCode;
  const now = Date.now();
  const inCurrentPeriod = row.currentPeriodStart instanceof Date
    && row.currentPeriodEnd instanceof Date
    && row.currentPeriodStart.getTime() <= now
    && row.currentPeriodEnd.getTime() > now;
  return {
    status,
    planCode,
    billingCycle: row.billingCycle as BillingCycle | null,
    currentPeriodStart: row.currentPeriodStart?.toISOString() || null,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() || null,
    nextChargeAt: row.nextChargeAt?.toISOString() || null,
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    scheduledPlanCode: row.scheduledPlanCode as PaidPlanCode | null,
    scheduledBillingCycle: row.scheduledBillingCycle as BillingCycle | null,
    cardIssuer: row.issuerName || row.issuerCode || null,
    cardNumberMasked: row.cardNumberMasked || null,
    cardLast4: row.cardLast4 || null,
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
    order by s.created_at desc limit 1
  `;
  if (!rows[0]) throw new HttpError(402, "활성 구독이 필요합니다.");
  return rows[0];
}
