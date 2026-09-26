import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { paddleRequest } from "./api";
import { paddleAmount, paddlePlan, type PaddleCurrency } from "./catalog";
import {
  assertPaddleEnabled,
  paddleEnvironment,
  paddlePriceId,
} from "./config";
import type {
  PaddleTransaction,
  PaddleSubscription,
  PaddleAdjustment,
} from "./models";
type Db = Sql | TransactionSql;

export function validatePaidTransaction(
  transaction: PaddleTransaction,
  code: string,
  currency: PaddleCurrency,
  priceId: string,
) {
  const item = transaction.items[0];
  const amount = Number(transaction.details.totals.total);
  const tax = Number(transaction.details.totals.tax);
  const principal =
    Number(transaction.details.totals.subtotal) -
    Number(transaction.details.totals.discount);
  if (
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(principal) ||
    principal <= 0 ||
    principal > amount ||
    !Number.isSafeInteger(tax) ||
    tax < 0 ||
    principal + tax !== amount ||
    Number(transaction.details.totals.discount) !== 0 ||
    transaction.discount_id ||
    item?.proration
  )
    throw new Error("Unsupported transaction adjustment");
  if (
    transaction.status !== "completed" ||
    !transaction.subscription_id ||
    !transaction.customer_id ||
    transaction.currency_code !== currency ||
    transaction.items.length !== 1 ||
    item?.quantity !== 1 ||
    item.price.id !== priceId ||
    item.price.unit_price.currency_code !== currency ||
    Number(item.price.unit_price.amount) !== paddleAmount(code, currency) ||
    item.price.billing_cycle?.interval !== "month" ||
    item.price.billing_cycle.frequency !== 1 ||
    amount > paddleAmount(code, currency) ||
    item.price.tax_mode !== "internal"
  ) {
    throw new Error("Paddle transaction does not match the server catalog");
  }
  // Paddle may remove included tax for a verified tax-exempt buyer. Validate
  // its canonical totals and the fixed price, rather than denying paid access.
  const start = new Date(transaction.billing_period?.starts_at || "");
  const end = new Date(transaction.billing_period?.ends_at || "");
  if (
    !Number.isFinite(+start) ||
    !Number.isFinite(+end) ||
    end <= start ||
    +end - +start > 32 * 86400000
  ) {
    throw new Error("Invalid paid period");
  }
  return { start, end, amount, principal };
}

export async function preparePaddleCheckout(
  userId: string,
  code: string,
  currency: PaddleCurrency,
  db = getDb(),
) {
  assertPaddleEnabled();
  paddlePlan(code);
  const environment = paddleEnvironment();
  const priceId = paddlePriceId(code, currency);
  const checkout = await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
    const accounts =
      await tx`select id from shorts_mvp.app_users where id=${userId} and withdrawn_at is null`;
    if (!accounts[0]) throw new HttpError(401, "Account not available.");
    const active =
      await tx`select id from shorts_mvp.user_subscriptions where user_id=${userId}
   and status in ('pending','trialing','active','past_due') and (billing_cycle='monthly' or current_period_end is null or current_period_end>now()) limit 1`;
    if (active.length)
      throw new HttpError(
        409,
        "Manage your existing subscription before starting another.",
        "EXISTING_SUBSCRIPTION",
      );
    const domestic =
      await tx`select 1 from shorts_mvp.billing_orders where user_id=${userId}
   and (status in ('processing','unknown','manual_review') or (status='pending' and (checkout_expires_at is null or checkout_expires_at>now())))
   union all select 1 from shorts_mvp.billing_toss_checkout_intents where user_id=${userId}
   and (status in ('processing','payment_method_registered','manual_review') or (status='prepared' and expires_at>now())) limit 1`;
    if (domestic.length)
      throw new HttpError(
        409,
        "An earlier payment is still pending.",
        "CHECKOUT_PENDING",
      );
    const pending =
      await tx`select * from shorts_mvp.paddle_checkouts where user_id=${userId} and environment=${environment}
   and status in ('creating','ready','unknown') order by created_at desc limit 1 for update`;
    if (pending[0]) {
      if (
        pending[0].status === "ready" &&
        pending[0].planCode === code &&
        pending[0].currency === currency
      )
        return pending[0];
      throw new HttpError(
        409,
        "An earlier checkout is still open. Please contact support.",
        "CHECKOUT_PENDING",
      );
    }
    const rows =
      await tx`insert into shorts_mvp.paddle_checkouts(user_id,environment,plan_code,currency,price_id)
   values(${userId},${environment},${code},${currency},${priceId}) returning *`;
    return rows[0];
  });
  if (checkout.transactionId) return checkout.transactionId as string;
  try {
    const result = await paddleRequest<{ id: string }>("/transactions", {
      items: [{ price_id: priceId, quantity: 1 }],
      currency_code: currency,
      collection_mode: "automatic",
      custom_data: { easycut_checkout_id: checkout.id },
    });
    await db`update shorts_mvp.paddle_checkouts set transaction_id=${result.id},status='ready'
   where id=${checkout.id} and status='creating'`;
    return result.id;
  } catch {
    // No automatic retry of a transaction creation whose outcome might be unknown.
    await db`update shorts_mvp.paddle_checkouts set status='unknown' where id=${checkout.id} and status='creating'`;
    throw new HttpError(
      503,
      "Checkout could not be confirmed. Please contact support.",
      "CHECKOUT_UNCONFIRMED",
    );
  }
}

async function applySubscription(tx: Db, sub: PaddleSubscription) {
  if (
    !["active", "trialing", "past_due", "paused", "canceled"].includes(
      sub.status,
    ) ||
    !Number.isFinite(Date.parse(sub.updated_at))
  )
    throw new Error("Unsupported subscription status");
  const rows =
    await tx`select * from shorts_mvp.paddle_subscriptions where paddle_id=${sub.id} for update`;
  const mapped = rows[0];
  if (!mapped) return;
  if (mapped.environment !== paddleEnvironment())
    throw new Error("Paddle environment mismatch");
  if (new Date(mapped.providerUpdatedAt) > new Date(sub.updated_at)) return;
  const status =
    sub.status === "canceled"
      ? "canceled"
      : sub.status === "paused"
        ? "past_due"
        : "active";
  // Paid-through dates come only from completed transactions, never subscription.created/updated.
  await tx`update shorts_mvp.paddle_subscriptions set provider_status=${sub.status},provider_updated_at=${sub.updated_at} where paddle_id=${sub.id}`;
  await tx`update shorts_mvp.user_subscriptions set status=${status},cancel_at_period_end=${sub.scheduled_change?.action === "cancel"},
  next_charge_at=${sub.next_billed_at},updated_at=now() where id=${mapped.subscriptionId}`;
  if (sub.status === "canceled") {
    await tx`update shorts_mvp.usage_grants set status='revoked' where subscription_id=${mapped.subscriptionId} and status='active'`;
  }
}

async function applyRefunds(tx: Db, transactionId: string) {
  const rows =
    await tx`select p.*,g.total_seconds,g.reserved_seconds,g.consumed_seconds,g.status as grant_status
  from shorts_mvp.paddle_payments p join shorts_mvp.usage_grants g on g.id=p.grant_id
  where p.transaction_id=${transactionId} for update of g`;
  const p = rows[0];
  if (!p) return;
  const sums =
    await tx`select coalesce(sum(principal_minor),0) as amount from shorts_mvp.paddle_adjustments
  where transaction_id=${transactionId} and status='approved' and action in ('refund','chargeback','chargeback_warning')`;
  const refunded = Math.max(0, Number(sums[0].amount));
  const plans =
    await tx`select pl.monthly_source_seconds,s.status as subscription_status from shorts_mvp.paddle_subscriptions ps
  join shorts_mvp.user_subscriptions s on s.id=ps.subscription_id join shorts_mvp.plans pl on pl.code=s.plan_code
  where ps.paddle_id=${p.paddleSubscriptionId}`;
  const original = Number(plans[0].monthlySourceSeconds);
  const entitlement = Math.max(
    0,
    Math.floor(
      original * (1 - Math.min(1, refunded / Number(p.principalMinor))),
    ),
  );
  // Preserve already consumed/reserved usage; revoke unspent allowance without breaking ledger constraints.
  const total = Math.max(
    1,
    entitlement,
    Number(p.reservedSeconds) + Number(p.consumedSeconds),
  );
  await tx`update shorts_mvp.usage_grants set total_seconds=${total},credited_seconds=${total},carried_seconds=0,
  status=${entitlement === 0 || plans[0].subscriptionStatus === "canceled" ? "revoked" : new Date(p.periodEnd) <= new Date() ? "expired" : "active"},updated_at=now() where id=${p.grantId}`;
}

async function loadTransactionAdjustments(transactionId: string) {
  const all: PaddleAdjustment[] = [];
  let after = "";
  // Refresh originals as well as reversals: a reversed chargeback is no longer
  // a deduction. Subtracting reversal amounts could incorrectly undo a refund.
  for (let page = 0; page < 5; page++) {
    const batch = await paddleRequest<PaddleAdjustment[]>(
      `/adjustments?transaction_id=${transactionId}&per_page=100${after ? `&after=${after}` : ""}`,
    );
    if (batch.some((item) => item.transaction_id !== transactionId))
      throw new Error("Adjustment ownership mismatch");
    all.push(...batch);
    if (batch.length < 100) return all;
    after = batch[batch.length - 1].id;
  }
  throw new Error("Adjustment pagination requires review");
}

export async function processPaddleEvent(
  event: {
    event_id: string;
    event_type: string;
    occurred_at: string;
    data: { id: string };
  },
  db = getDb(),
) {
  const kind = event.event_type;
  // Fetch canonical objects. Do not trust arrival order or grant access from browser callbacks.
  const transaction =
    kind === "transaction.completed" || kind === "transaction.canceled"
      ? await paddleRequest<PaddleTransaction>(`/transactions/${event.data.id}`)
      : null;
  const adjustments =
    kind === "adjustment.created" || kind === "adjustment.updated"
      ? await paddleRequest<PaddleAdjustment[]>(
          `/adjustments?id=${event.data.id}`,
        )
      : null;
  const adjustment = adjustments?.find((a) => a.id === event.data.id);
  if (adjustments && !adjustment) throw new Error("Adjustment not found");
  const adjustmentSnapshot = adjustment
    ? await loadTransactionAdjustments(adjustment.transaction_id)
    : [];
  if (
    adjustment &&
    !adjustmentSnapshot.some((item) => item.id === adjustment.id)
  )
    throw new Error("Incomplete adjustment snapshot");
  const subId = kind.startsWith("subscription.")
    ? event.data.id
    : transaction?.subscription_id;
  const sub = subId
    ? await paddleRequest<PaddleSubscription>(`/subscriptions/${subId}`)
    : null;
  return db.begin(async (tx) => {
    const claimed =
      await tx`insert into shorts_mvp.paddle_webhook_events(event_id,event_type,occurred_at)
   values(${event.event_id},${kind},${event.occurred_at}) on conflict do nothing returning event_id`;
    if (!claimed.length) return "duplicate";
    if (transaction?.status === "completed") {
      const rawCheckoutId = transaction.custom_data?.easycut_checkout_id;
      const checkoutId =
        typeof rawCheckoutId === "string" &&
        /^[0-9a-f-]{36}$/i.test(rawCheckoutId)
          ? rawCheckoutId
          : null;
      const existing =
        await tx`select * from shorts_mvp.paddle_subscriptions where paddle_id=${transaction.subscription_id}`;
      let mapped = existing[0];
      const checkouts = checkoutId
        ? await tx`select * from shorts_mvp.paddle_checkouts where id=${checkoutId}`
        : [];
      const checkout = checkouts[0];
      if (!mapped && !checkout) throw new Error("Unmapped Paddle transaction");
      const userId = mapped?.userId || checkout.userId;
      await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
      if (!mapped) {
        const latest =
          await tx`select * from shorts_mvp.paddle_subscriptions where paddle_id=${transaction.subscription_id} for update`;
        mapped = latest[0];
      }
      const current = mapped
        ? await tx`select plan_code from shorts_mvp.user_subscriptions where id=${mapped.subscriptionId}`
        : [];
      const code = mapped ? current[0].planCode : checkout.planCode;
      const currency = transaction.currency_code as PaddleCurrency;
      if (currency !== "USD" && currency !== "JPY")
        throw new Error("Unsupported transaction currency");
      if (
        checkout &&
        (checkout.environment !== paddleEnvironment() ||
          checkout.userId !== userId ||
          checkout.currency !== currency)
      )
        throw new Error("Checkout ownership mismatch");
      if (
        !mapped &&
        checkout.transactionId &&
        checkout.transactionId !== transaction.id
      )
        throw new Error("Checkout transaction mismatch");
      const paid = validatePaidTransaction(
        transaction,
        code,
        currency,
        paddlePriceId(code, currency),
      );
      if (
        !sub ||
        sub.customer_id !== transaction.customer_id ||
        sub.items.length !== 1 ||
        sub.items[0].price.id !== paddlePriceId(code, currency) ||
        sub.items[0].quantity !== 1
      )
        throw new Error("Subscription mismatch");
      if (!mapped) {
        const active =
          await tx`select id from shorts_mvp.user_subscriptions where user_id=${userId}
     and status in ('pending','trialing','active','past_due') and (billing_cycle='monthly' or current_period_end is null or current_period_end>now()) limit 1`;
        if (active.length)
          throw new Error("Conflicting subscription requires review");
        const id = randomUUID();
        await tx`insert into shorts_mvp.user_subscriptions(id,user_id,plan_code,status,billing_cycle,payment_provider,current_period_start,current_period_end)
     values(${id},${userId},${code},'active','monthly','paddle',${paid.start},${paid.end})`;
        const rows =
          await tx`insert into shorts_mvp.paddle_subscriptions(paddle_id,user_id,subscription_id,customer_id,environment,provider_status,provider_updated_at)
     values(${sub.id},${userId},${id},${sub.customer_id},${paddleEnvironment()},${sub.status},${sub.updated_at}) returning *`;
        mapped = rows[0];
      }
      if (
        mapped.environment !== paddleEnvironment() ||
        mapped.customerId !== transaction.customer_id
      )
        throw new Error("Paddle ownership mismatch");
      const inserted =
        await tx`insert into shorts_mvp.paddle_payments(transaction_id,user_id,paddle_subscription_id,currency,amount_minor,principal_minor,period_start,period_end)
    values(${transaction.id},${userId},${sub.id},${currency},${paid.amount},${paid.principal},${paid.start},${paid.end}) on conflict do nothing returning transaction_id`;
      if (inserted.length) {
        const seconds = paddlePlan(code).minutes * 60;
        const grants =
          await tx`insert into shorts_mvp.usage_grants(user_id,subscription_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,valid_from,expires_at)
     values(${userId},${mapped.subscriptionId},'base',${code},${seconds},${seconds},0,${paid.start},${paid.end})
     on conflict (subscription_id,valid_from,kind) where subscription_id is not null and kind='base' do nothing returning id`;
        if (!grants.length)
          throw new Error("Duplicate paid period requires review");
        await tx`update shorts_mvp.paddle_payments set grant_id=${grants[0].id} where transaction_id=${transaction.id}`;
        await tx`update shorts_mvp.user_subscriptions set current_period_start=${paid.start},current_period_end=${paid.end}
     where id=${mapped.subscriptionId} and (current_period_end is null or current_period_end<=${paid.end})`;
      }
      if (checkout)
        await tx`update shorts_mvp.paddle_checkouts set status='completed',transaction_id=coalesce(transaction_id,${transaction.id}) where id=${checkout.id}`;
      await applyRefunds(tx, transaction.id);
    }
    if (transaction?.status === "canceled")
      await tx`update shorts_mvp.paddle_checkouts set status='canceled' where transaction_id=${transaction.id}`;
    if (adjustment) {
      for (const entry of adjustmentSnapshot) {
        const amount = Math.abs(Number(entry.totals.total));
        const principal = Math.abs(Number(entry.totals.subtotal));
        if (
          !Number.isSafeInteger(amount) ||
          !Number.isSafeInteger(principal) ||
          principal > amount
        )
          throw new Error("Invalid adjustment amount");
        await tx`insert into shorts_mvp.paddle_adjustments(id,transaction_id,amount_minor,principal_minor,status,action,provider_updated_at)
     values(${entry.id},${entry.transaction_id},${amount},${principal},${entry.status},${entry.action},${entry.updated_at})
     on conflict(id) do update set amount_minor=excluded.amount_minor,principal_minor=excluded.principal_minor,status=excluded.status,action=excluded.action,provider_updated_at=excluded.provider_updated_at
     where shorts_mvp.paddle_adjustments.provider_updated_at<=excluded.provider_updated_at`;
      }
      await applyRefunds(tx, adjustment.transaction_id);
    }
    if (sub) await applySubscription(tx, sub);
    return "processed";
  });
}

export async function getPaddleState(userId: string, db = getDb()) {
  paddleEnvironment();
  const rows =
    await db`select ps.paddle_id,ps.provider_status,s.plan_code,s.current_period_end,s.cancel_at_period_end
  from shorts_mvp.paddle_subscriptions ps join shorts_mvp.user_subscriptions s on s.id=ps.subscription_id
  where ps.user_id=${userId} and ps.environment=${paddleEnvironment()} order by ps.created_at desc limit 1`;
  return rows[0] || null;
}
export async function createPaddlePortal(userId: string, db = getDb()) {
  paddleEnvironment();
  const rows =
    await db`select customer_id,paddle_id from shorts_mvp.paddle_subscriptions where user_id=${userId} and environment=${paddleEnvironment()} order by created_at desc limit 1`;
  if (!rows[0]) throw new HttpError(404, "No Paddle subscription found.");
  const portal = await paddleRequest<{
    urls: { general: { overview: string } };
  }>(`/customers/${rows[0].customerId}/portal-sessions`, {
    subscription_ids: [rows[0].paddleId],
  });
  const url = new URL(portal.urls.general.overview);
  if (
    url.protocol !== "https:" ||
    ![
      "customer-portal.paddle.com",
      "sandbox-customer-portal.paddle.com",
    ].includes(url.hostname)
  )
    throw new Error("Unexpected portal URL");
  return url.toString();
}

export async function resumePaddleCheckout(
  userId: string,
  transactionId: string,
  db = getDb(),
) {
  assertPaddleEnabled();
  const rows =
    await db`select transaction_id from shorts_mvp.paddle_checkouts where user_id=${userId} and transaction_id=${transactionId} and environment=${paddleEnvironment()} and status='ready'`;
  if (!rows[0])
    throw new HttpError(404, "Checkout not found.", "CHECKOUT_NOT_FOUND");
  return rows[0].transactionId as string;
}
export async function cancelPaddleCheckout(userId: string, db = getDb()) {
  assertPaddleEnabled();
  return db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
    const rows =
      await tx`select * from shorts_mvp.paddle_checkouts where user_id=${userId} and environment=${paddleEnvironment()} and status in ('creating','ready','unknown') order by created_at desc limit 1 for update`;
    const row = rows[0];
    if (!row) return;
    if (!row.transactionId)
      throw new HttpError(
        409,
        "Please contact support to reconcile this checkout.",
        "CHECKOUT_UNCONFIRMED",
      );
    const current = await paddleRequest<PaddleTransaction>(
      `/transactions/${row.transactionId}`,
    );
    if (!["draft", "ready", "canceled"].includes(current.status))
      throw new HttpError(
        409,
        "Payment is being processed. Please wait.",
        "CHECKOUT_PROCESSING",
      );
    if (current.status !== "canceled") {
      const canceled = await paddleRequest<PaddleTransaction>(
        `/transactions/${row.transactionId}`,
        { status: "canceled" },
        "PATCH",
      );
      if (canceled.status !== "canceled")
        throw new Error("Checkout cancellation unconfirmed");
    }
    await tx`update shorts_mvp.paddle_checkouts set status='canceled' where id=${row.id}`;
  });
}
