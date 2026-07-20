import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  addKstMonths,
  createBaseUsageGrant,
  createProviderOrderId,
  getPaidPlan,
  syncCachedPlan,
} from "@/lib/billing";
import {
  chargeBillingKey,
  decryptBillingKey,
  deleteBillingKey,
  getTossPaymentByOrderId,
  TossApiError,
  type TossPayment,
} from "@/lib/toss";

function retryDelayDays(attemptNo: number) {
  return [1, 3, 7][Math.max(0, Math.min(2, attemptNo - 1))];
}

async function expireSubscription(db: Sql, subscription: Record<string, unknown>) {
  const method = await db`
    select * from shorts_mvp.billing_payment_methods where id=${subscription.paymentMethodId as string} limit 1
  `;
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.user_subscriptions
      set status=${subscription.cancelAtPeriodEnd ? "canceled" : "expired"},ended_at=now(),
        next_charge_at=null,next_retry_at=null,next_quota_at=null
      where id=${subscription.id as string} and status in ('active','past_due')
    `;
    await syncCachedPlan(tx, subscription.userId as string, "free");
    await tx`
      update shorts_mvp.billing_payment_methods set status='revoked',revoked_at=now()
      where id=${subscription.paymentMethodId as string}
    `;
  });
  if (method[0]) {
    try {
      await deleteBillingKey(decryptBillingKey({
        ciphertext: method[0].billingKeyCiphertext,
        iv: method[0].billingKeyIv,
        tag: method[0].billingKeyTag,
      }));
    } catch (error) {
      console.error("toss_billing_key_delete_failed", {
        subscriptionId: subscription.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

async function finalizeRenewal(
  db: Sql,
  subscription: Record<string, unknown>,
  order: Record<string, unknown>,
  attemptId: string,
  providerOrderId: string,
  payment: TossPayment,
) {
  const targetPlanCode = String(subscription.scheduledPlanCode || subscription.planCode);
  const targetCycle = String(subscription.scheduledBillingCycle || subscription.billingCycle);
  const plan = await getPaidPlan(db, targetPlanCode);
  const periodStart = subscription.currentPeriodEnd as Date;
  const periodEnd = addKstMonths(
    periodStart,
    targetCycle === "yearly" ? 12 : 1,
    Number(subscription.billingAnchorDay),
  );
  await db.begin(async (tx) => {
    const locked = await tx`
      select status,current_period_end from shorts_mvp.user_subscriptions
      where id=${subscription.id as string} for update
    `;
    if (!locked[0] || locked[0].currentPeriodEnd.getTime() !== periodStart.getTime()) return;
    await tx`
      update shorts_mvp.billing_attempts
      set status='succeeded',payment_key=${payment.paymentKey},finished_at=now()
      where id=${attemptId}
    `;
    await tx`
      update shorts_mvp.billing_orders
      set status='succeeded',payment_key=${payment.paymentKey},provider_status=${payment.status},
        approved_at=${payment.approvedAt ? new Date(payment.approvedAt) : new Date()},failure_code=null,failure_message=null
      where id=${order.id as string}
    `;
    await tx`
      update shorts_mvp.user_subscriptions
      set plan_code=${plan.code},billing_cycle=${targetCycle},status='active',
        current_period_start=${periodStart},current_period_end=${periodEnd},
        next_charge_at=${periodEnd},next_retry_at=null,grace_ends_at=null,retry_count=0,
        scheduled_plan_code=null,scheduled_billing_cycle=null
      where id=${subscription.id as string}
    `;
    const quotaEnd = await createBaseUsageGrant({
      db: tx,
      userId: subscription.userId as string,
      subscriptionId: subscription.id as string,
      billingOrderId: order.id as string,
      plan,
      validFrom: periodStart,
      subscriptionEnd: periodEnd,
      billingAnchorDay: Number(subscription.billingAnchorDay),
    });
    await tx`update shorts_mvp.user_subscriptions set next_quota_at=${quotaEnd} where id=${subscription.id as string}`;
    await syncCachedPlan(tx, subscription.userId as string, plan.code);
  });
  return providerOrderId;
}

async function recordRenewalFailure(
  db: Sql,
  subscription: Record<string, unknown>,
  orderId: string,
  attemptId: string,
  attemptNo: number,
  error: TossApiError,
) {
  if (error.outcomeUnknown) {
    await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.billing_attempts set status='unknown',provider_code=${error.code},finished_at=now()
        where id=${attemptId}
      `;
      await tx`
        update shorts_mvp.billing_orders set status='unknown',failure_code=${error.code},failure_message=${error.message.slice(0,300)}
        where id=${orderId}
      `;
      await tx`
        update shorts_mvp.user_subscriptions
        set status='past_due',next_retry_at=now()+interval '1 hour',
          grace_ends_at=coalesce(grace_ends_at,${subscription.currentPeriodEnd as Date}+interval '7 days')
        where id=${subscription.id as string}
      `;
    });
    return;
  }
  await db`
    update shorts_mvp.billing_attempts set status='failed',provider_code=${error.code},finished_at=now()
    where id=${attemptId}
  `;
  if (attemptNo >= 4) {
    await db`
      update shorts_mvp.billing_orders set status='failed',failure_code=${error.code},failure_message=${error.message.slice(0,300)}
      where id=${orderId}
    `;
    await expireSubscription(db, { ...subscription, cancelAtPeriodEnd: false });
    return;
  }
  const delay = retryDelayDays(attemptNo);
  await db.begin(async (tx) => {
    await tx`
      update shorts_mvp.billing_orders set status='failed',failure_code=${error.code},failure_message=${error.message.slice(0,300)}
      where id=${orderId}
    `;
    await tx`
      update shorts_mvp.user_subscriptions
      set status='past_due',retry_count=${Math.max(0,attemptNo-1)},
        next_retry_at=greatest(clock_timestamp(),${subscription.currentPeriodEnd as Date}+${delay}*interval '1 day'),
        grace_ends_at=coalesce(grace_ends_at,${subscription.currentPeriodEnd as Date}+interval '7 days')
      where id=${subscription.id as string}
    `;
  });
}

async function processSubscriptionRenewal(db: Sql, subscriptionId: string) {
  const rows = await db`
    select s.*,u.email,u.display_name,m.customer_key,m.billing_key_ciphertext,
      m.billing_key_iv,m.billing_key_tag
    from shorts_mvp.user_subscriptions s
    join shorts_mvp.app_users u on u.id=s.user_id
    join shorts_mvp.billing_payment_methods m on m.id=s.payment_method_id and m.status='active'
    where s.id=${subscriptionId} and s.status in ('active','past_due')
    limit 1
  `;
  const subscription = rows[0];
  if (!subscription) return "ignored";
  if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd <= new Date()) {
    await expireSubscription(db, subscription);
    return "canceled";
  }
  const targetPlanCode = String(subscription.scheduledPlanCode || subscription.planCode);
  const targetCycle = String(subscription.scheduledBillingCycle || subscription.billingCycle);
  const plan = await getPaidPlan(db, targetPlanCode);
  const amount = targetCycle === "yearly" ? plan.yearlyPriceKrw : plan.monthlyPriceKrw;
  const existing = await db`
    select * from shorts_mvp.billing_orders
    where subscription_id=${subscription.id} and kind='subscription_renewal'
      and renewal_period_start=${subscription.currentPeriodEnd}
    limit 1
  `;
  let order = existing[0];
  if (!order) {
    const created = await db`
      insert into shorts_mvp.billing_orders (
        user_id,subscription_id,payment_method_id,request_id,kind,product_code,billing_cycle,
        amount_krw,order_id,order_name,customer_key,status,renewal_period_start
      ) values (
        ${subscription.userId},${subscription.id},${subscription.paymentMethodId},${randomUUID()},
        'subscription_renewal',${plan.code},${targetCycle},${amount},${createProviderOrderId("REN")},
        ${`Easy Cut ${plan.displayName} 구독 갱신`},${subscription.customerKey},'processing',${subscription.currentPeriodEnd}
      ) on conflict (subscription_id,renewal_period_start)
        where kind='subscription_renewal' and renewal_period_start is not null
      do nothing returning *
    `;
    order = created[0] || (await db`
      select * from shorts_mvp.billing_orders
      where subscription_id=${subscription.id} and kind='subscription_renewal'
        and renewal_period_start=${subscription.currentPeriodEnd} limit 1
    `)[0];
  }
  const unknown = await db`
    select * from shorts_mvp.billing_attempts
    where order_id=${order.id} and status='unknown'
    order by attempt_no desc limit 1
  `;
  if (unknown[0]) {
    try {
      const reconciled = await getTossPaymentByOrderId(unknown[0].providerOrderId);
      if (reconciled.status === "DONE" && reconciled.totalAmount === amount) {
        await finalizeRenewal(db, subscription, order, unknown[0].id, unknown[0].providerOrderId, reconciled);
        return "reconciled";
      }
    } catch (error) {
      if (error instanceof TossApiError && error.outcomeUnknown) return "unknown";
    }
    await recordRenewalFailure(
      db,
      subscription,
      order.id,
      unknown[0].id,
      Number(unknown[0].attemptNo),
      new TossApiError(
        "이전 갱신 주문이 승인되지 않은 상태로 확인되었습니다.",
        "RECONCILED_NOT_DONE",
        409,
        false,
      ),
    );
    return "reconciled_not_done";
  }
  const counts = await db`select count(*)::int as count from shorts_mvp.billing_attempts where order_id=${order.id}`;
  const attemptNo = Number(counts[0].count)+1;
  if (attemptNo > 4) {
    await expireSubscription(db, { ...subscription, cancelAtPeriodEnd: false });
    return "expired";
  }
  const providerOrderId = createProviderOrderId("REN");
  const attempts = await db`
    insert into shorts_mvp.billing_attempts (order_id,attempt_no,provider_order_id)
    values (${order.id},${attemptNo},${providerOrderId})
    on conflict (order_id,attempt_no) do nothing
    returning id
  `;
  // A concurrent cron invocation claimed this exact retry first. Only the
  // process that inserted the attempt may call Toss with its provider order ID.
  if (!attempts[0]) return "claimed_elsewhere";
  try {
    const billingKey = decryptBillingKey({
      ciphertext: subscription.billingKeyCiphertext,
      iv: subscription.billingKeyIv,
      tag: subscription.billingKeyTag,
    });
    const payment = await chargeBillingKey({
      billingKey,
      customerKey: subscription.customerKey,
      amount,
      orderId: providerOrderId,
      orderName: `Easy Cut ${plan.displayName} 구독 갱신`,
      customerEmail: subscription.email,
      customerName: subscription.displayName,
    });
    if (payment.status !== "DONE" || payment.totalAmount !== amount || payment.orderId !== providerOrderId) {
      throw new TossApiError("구독 갱신 승인 결과가 주문 정보와 일치하지 않습니다.", "MISMATCHED_PAYMENT", 502, true);
    }
    await finalizeRenewal(db, subscription, order, attempts[0].id, providerOrderId, payment);
    return "succeeded";
  } catch (error) {
    const tossError = error instanceof TossApiError
      ? error
      : new TossApiError("구독 갱신 처리에 실패했습니다.", "RENEWAL_ERROR", 502, true);
    await recordRenewalFailure(db, subscription, order.id, attempts[0].id, attemptNo, tossError);
    return tossError.outcomeUnknown ? "unknown" : "failed";
  }
}

async function createDueAnnualQuota(db: Sql, subscriptionId: string) {
  const rows = await db`
    select s.* from shorts_mvp.user_subscriptions s
    where s.id=${subscriptionId} and s.status='active' and s.billing_cycle='yearly'
      and s.next_quota_at <= clock_timestamp() and s.current_period_end > s.next_quota_at
    limit 1
  `;
  const subscription = rows[0];
  if (!subscription) return false;
  const orders = await db`
    select id from shorts_mvp.billing_orders
    where subscription_id=${subscription.id} and status='succeeded'
    order by approved_at desc nulls last limit 1
  `;
  if (!orders[0]) return false;
  const plan = await getPaidPlan(db, subscription.planCode);
  const quotaEnd = await createBaseUsageGrant({
    db,
    userId: subscription.userId,
    subscriptionId: subscription.id,
    billingOrderId: orders[0].id,
    plan,
    validFrom: subscription.nextQuotaAt,
    subscriptionEnd: subscription.currentPeriodEnd,
    billingAnchorDay: Number(subscription.billingAnchorDay),
  });
  await db`update shorts_mvp.user_subscriptions set next_quota_at=${quotaEnd} where id=${subscription.id}`;
  return true;
}

async function reconcileUnknownCheckout(db: Sql, order: Record<string, unknown>) {
  let payment: TossPayment;
  try {
    payment = await getTossPaymentByOrderId(order.orderId as string);
  } catch (error) {
    if (error instanceof TossApiError && error.outcomeUnknown) return "unknown";
    await db`
      update shorts_mvp.billing_orders set status='failed',failure_code='RECONCILED_NOT_FOUND'
      where id=${order.id as string} and status='unknown'
    `;
    await db`
      update shorts_mvp.billing_attempts
      set status='failed',provider_code='RECONCILED_NOT_FOUND',finished_at=now()
      where order_id=${order.id as string} and status='unknown'
    `;
    return "failed";
  }
  if (payment.totalAmount !== Number(order.amountKrw) || payment.orderId !== order.orderId) {
    await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.billing_orders
        set status='failed',failure_code='RECONCILED_PAYMENT_MISMATCH'
        where id=${order.id as string} and status='unknown'
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='failed',provider_code='RECONCILED_PAYMENT_MISMATCH',finished_at=now()
        where order_id=${order.id as string} and status='unknown'
      `;
    });
    return "mismatch";
  }
  if (payment.status !== "DONE") return "not_done";
  const approvedAt = payment.approvedAt ? new Date(payment.approvedAt) : new Date();
  if (order.kind === "addon") {
    const productRows = await db`
      select * from shorts_mvp.addon_products where code=${order.productCode as string} limit 1
    `;
    const product = productRows[0];
    if (!product) return "missing_product";
    await db.begin(async (tx) => {
      await tx`
        insert into shorts_mvp.usage_grants (
          user_id,subscription_id,billing_order_id,kind,product_code,total_seconds,valid_from,expires_at
        ) values (
          ${order.userId as string},${order.subscriptionId as string},${order.id as string},'addon',
          ${order.productCode as string},${product.seconds},${approvedAt},
          ${approvedAt}+${product.validityDays}*interval '1 day'
        ) on conflict (billing_order_id) where kind='addon' do nothing
      `;
      await tx`
        update shorts_mvp.billing_orders
        set status='succeeded',payment_key=${payment.paymentKey},provider_status=${payment.status},approved_at=${approvedAt}
        where id=${order.id as string}
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='succeeded',payment_key=${payment.paymentKey},finished_at=now()
        where order_id=${order.id as string} and provider_order_id=${order.orderId as string}
      `;
    });
    return "succeeded";
  }
  if (order.kind !== "subscription_initial" || !order.paymentMethodId) return "ignored";
  const existing = await db`
    select id from shorts_mvp.user_subscriptions
    where user_id=${order.userId as string} and status in ('pending','trialing','active','past_due') limit 1
  `;
  if (existing[0]) {
    await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.billing_orders set status='succeeded',subscription_id=${existing[0].id},
          payment_key=${payment.paymentKey},provider_status=${payment.status},approved_at=${approvedAt}
        where id=${order.id as string}
      `;
      await tx`
        update shorts_mvp.billing_attempts
        set status='succeeded',payment_key=${payment.paymentKey},finished_at=now()
        where order_id=${order.id as string} and provider_order_id=${order.orderId as string}
      `;
    });
    return "already_active";
  }
  const plan = await getPaidPlan(db, order.productCode as string);
  const periodEnd = addKstMonths(approvedAt, order.billingCycle === "yearly" ? 12 : 1);
  await db.begin(async (tx) => {
    const subscriptions = await tx`
      insert into shorts_mvp.user_subscriptions (
        user_id,plan_code,status,provider,billing_cycle,payment_method_id,
        current_period_start,current_period_end,next_charge_at,next_quota_at,billing_anchor_day
      ) values (
        ${order.userId as string},${plan.code},'active','toss',${order.billingCycle as string},
        ${order.paymentMethodId as string},${approvedAt},${periodEnd},${periodEnd},${addKstMonths(approvedAt,1)},
        ${new Date(approvedAt.getTime()+9*60*60*1000).getUTCDate()}
      ) returning id
    `;
    const quotaEnd = await createBaseUsageGrant({
      db: tx,
      userId: order.userId as string,
      subscriptionId: subscriptions[0].id,
      billingOrderId: order.id as string,
      plan,
      validFrom: approvedAt,
      subscriptionEnd: periodEnd,
    });
    await tx`update shorts_mvp.user_subscriptions set next_quota_at=${quotaEnd} where id=${subscriptions[0].id}`;
    await tx`
      update shorts_mvp.billing_orders set status='succeeded',subscription_id=${subscriptions[0].id},
        payment_key=${payment.paymentKey},provider_status=${payment.status},approved_at=${approvedAt}
      where id=${order.id as string}
    `;
    await tx`
      update shorts_mvp.billing_attempts
      set status='succeeded',payment_key=${payment.paymentKey},finished_at=now()
      where order_id=${order.id as string} and provider_order_id=${order.orderId as string}
    `;
    await syncCachedPlan(tx, order.userId as string, plan.code);
  });
  return "succeeded";
}

export async function processBillingRenewals(db: Sql) {
  const expiredCheckouts = await db`
    update shorts_mvp.billing_orders set status='expired',failure_code='CHECKOUT_EXPIRED'
    where status='pending' and checkout_expires_at <= clock_timestamp()
    returning id
  `;
  await db`
    update shorts_mvp.billing_orders set status='unknown',failure_code='PROCESS_INTERRUPTED'
    where status='processing' and kind in ('subscription_initial','addon')
      and updated_at < clock_timestamp()-interval '2 minutes'
  `;
  const unknownOrders = await db`
    select * from shorts_mvp.billing_orders
    where status='unknown' and kind in ('subscription_initial','addon')
      and updated_at < clock_timestamp()-interval '1 minute'
    order by updated_at limit 50
  `;
  const reconciled: Record<string,string> = {};
  for (const order of unknownOrders) reconciled[order.id] = await reconcileUnknownCheckout(db, order);

  const quotaRows = await db`
    select id from shorts_mvp.user_subscriptions
    where status='active' and billing_cycle='yearly' and next_quota_at <= clock_timestamp()
      and current_period_end > next_quota_at
    order by next_quota_at limit 100
  `;
  let quotasCreated = 0;
  for (const row of quotaRows) if (await createDueAnnualQuota(db, row.id)) quotasCreated += 1;

  const dueRows = await db`
    select id from shorts_mvp.user_subscriptions
    where (
      status='active' and next_charge_at <= clock_timestamp()
    ) or (
      status='past_due' and next_retry_at <= clock_timestamp()
    )
    order by coalesce(next_retry_at,next_charge_at) limit 50
  `;
  const results: Record<string,string> = {};
  for (const row of dueRows) results[row.id] = await processSubscriptionRenewal(db, row.id);
  return {
    expiredCheckouts: expiredCheckouts.length,
    reconciled,
    quotasCreated,
    processed: dueRows.length,
    results,
  };
}
