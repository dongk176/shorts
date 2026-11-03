import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { paypalEnvironment, paypalRequest } from "./api";
import { paypalPlan, usdMinor, addPayPalMonths } from "./catalog";
import { assertPayPalNewCustomer } from "./eligibility";
import { assertNoPayPalBillingConflicts } from "./service";
import { cancelPayPalCheckout, syncPayPalSubscription, type PayPalSubscription } from "./service";
import { oneTimeEnabled, oneTimeReturnOrigin } from "./one-time-config";
import { localizedHref } from "@/lib/i18n/routing";

type Db = ReturnType<typeof getDb>;
type LocalOrder = {
  id: string; userId: string; planCode: string; locale: "en" | "ja"; status: string;
  providerOrderId: string | null; merchantId: string | null; approvalUrl: string | null;
  captureId: string | null; paidAt: Date | null; accessEnd: Date | null;
  environment: string; subscriptionId: string | null; refundedMinor: number; reversed: boolean; entitlementHold: boolean;
  createdAt: Date; updatedAt: Date; captureStartedAt: Date | null;
};
type Money = { currency_code: string; value: string };
export type PayPalOrder = {
  id: string; intent: string; status: string;
  purchase_units: {
    reference_id: string; custom_id: string; invoice_id: string; amount: Money;
    payee: { merchant_id: string };
    payments?: { captures?: PayPalCapture[]; refunds?: {id:string}[] };
  }[];
  links?: { rel: string; href: string }[];
};
export type PayPalCapture = {
  id: string; status: string; amount: Money; final_capture: boolean; create_time: string;
  supplementary_data?: { related_ids?: { order_id?: string } };
};
type Refund = {id:string;status:string;amount:Money;links:{rel:string;href:string}[]};
const providerId = /^[A-Z0-9]{10,32}$/;
const unconfirmed = () => new HttpError(409, "Payment outcome needs confirmation.", "CHECKOUT_UNCONFIRMED");

export function validateOneTimeOrder(remote: PayPalOrder, local: Pick<LocalOrder, "id" | "planCode" | "providerOrderId" | "merchantId">) {
  const unit = remote.purchase_units?.[0];
  if (!providerId.test(remote.id) || (local.providerOrderId && remote.id !== local.providerOrderId)
    || remote.intent !== "CAPTURE" || remote.purchase_units.length !== 1
    || unit?.reference_id !== local.id || unit.custom_id !== local.id || unit.invoice_id !== `EC-${local.id}`
    || unit.amount?.currency_code !== "USD" || usdMinor(unit.amount.value) !== paypalPlan(local.planCode).amount
    || !/^[A-Z0-9]{10,32}$/.test(unit.payee?.merchant_id || "")
    || (local.merchantId && local.merchantId !== unit.payee.merchant_id)
    || (process.env.PAYPAL_MERCHANT_ID && process.env.PAYPAL_MERCHANT_ID !== unit.payee.merchant_id)) throw Error("PayPal order mismatch");
  return unit;
}

export function validateOneTimeCapture(capture: PayPalCapture, local: Pick<LocalOrder, "planCode" | "providerOrderId">, expectedId: string, statuses:readonly string[]=["COMPLETED","PARTIALLY_REFUNDED","REFUNDED"]) {
  if (capture.id !== expectedId || !providerId.test(capture.id) || !statuses.includes(capture.status)
    || capture.amount?.currency_code !== "USD" || usdMinor(capture.amount.value) !== paypalPlan(local.planCode).amount
    || capture.final_capture !== true || !Number.isFinite(Date.parse(capture.create_time))
    || capture.supplementary_data?.related_ids?.order_id !== local.providerOrderId) throw Error("PayPal capture mismatch");
  return new Date(capture.create_time);
}

function view(row: LocalOrder) {
  const plan = paypalPlan(row.planCode);
  const status = row.reversed ? "reversed" : row.status === "completed" && Number(row.refundedMinor) >= plan.amount ? "refunded" : row.entitlementHold ? "review" : row.status;
  return { checkoutId: row.id, planCode: row.planCode, status,
    paid: row.status === "completed" && !row.reversed && !row.entitlementHold && Number(row.refundedMinor) < plan.amount, accessEnd: row.accessEnd ? new Date(row.accessEnd).toISOString() : null,
    monthlyMinutes: plan.minutes, months: plan.months, automaticRenewal: false };
}

async function owned(userId: string, id: string, db: Db) {
  oneTimeReturnOrigin();
  const [row] = await db<LocalOrder[]>`select * from shorts_mvp.paypal_one_time_orders where id=${id} and user_id=${userId} and environment=${paypalEnvironment()}`;
  if (!row) throw new HttpError(404, "Checkout not found.");
  return row;
}

export async function getOneTimeState(userId: string, id: string, db = getDb()) {
  return view(await owned(userId, id, db));
}
export async function latestOneTimeOrder(userId:string,db=getDb()) {
  if(!oneTimeEnabled())return null;
  const [row]=await db<LocalOrder[]>`select * from shorts_mvp.paypal_one_time_orders where user_id=${userId} and environment=${paypalEnvironment()} and status='completed' order by paid_at desc limit 1`;
  return row?view(row):null;
}

export async function prepareOneTimeOrder(userId: string, code: string, locale: "en" | "ja", db = getDb(), replacements = 0): Promise<{ checkoutId: string; approvalUrl: string }> {
  const origin = oneTimeReturnOrigin(), plan = paypalPlan(code);
  await assertPayPalNewCustomer(userId,db);
  // Retire only canonically unpaid old checkouts. A missing/uncertain reference
  // is never taken as evidence that no recurring charge can occur.
  const old = await db`select id,provider_subscription_id from shorts_mvp.paypal_checkouts where user_id=${userId} and environment=${paypalEnvironment()} and status in ('creating','ready','unknown') order by created_at limit 10`;
  for (const previous of old) {
    if (!previous.providerSubscriptionId) throw unconfirmed();
    const remote = await paypalRequest<PayPalSubscription>(`/v1/billing/subscriptions/${previous.providerSubscriptionId}`);
    if (remote.status === "APPROVAL_PENDING") await cancelPayPalCheckout(userId, previous.id, db);
    else if (["CANCELLED","EXPIRED"].includes(remote.status)) await syncPayPalSubscription(previous.providerSubscriptionId, db);
    else throw unconfirmed();
  }
  const row = await db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
    await assertPayPalNewCustomer(userId, tx);
    const [account] = await tx`select withdrawn_at from shorts_mvp.app_users where id=${userId}`;
    if (!account || account.withdrawnAt) throw new HttpError(409, "Account unavailable.");
    await tx`update shorts_mvp.user_subscriptions s set status='expired',updated_at=now() where s.user_id=${userId} and s.status='active' and s.current_period_end<=now() and exists(select 1 from shorts_mvp.paypal_one_time_orders o where o.subscription_id=s.id and o.environment=${paypalEnvironment()})`;
    const [previous] = await tx<LocalOrder[]>`select * from shorts_mvp.paypal_one_time_orders where user_id=${userId} and environment=${paypalEnvironment()} and status in ('creating','ready','capturing','unknown') for update`;
    if (previous) {
      if (previous.status === "ready") return previous;
      if(previous.status==='unknown'&&!previous.providerOrderId&&previous.planCode===code&&Date.now()-new Date(previous.createdAt).getTime()<5*60_000&&Date.now()-new Date(previous.updatedAt).getTime()>30_000) {
        const [retry]=await tx<LocalOrder[]>`update shorts_mvp.paypal_one_time_orders set status='creating',updated_at=now() where id=${previous.id} returning *`;
        return retry;
      }
      throw unconfirmed();
    }
    await assertNoPayPalBillingConflicts(tx, userId);
    const [recurring] = await tx`select id from shorts_mvp.paypal_checkouts where user_id=${userId} and status in ('creating','ready','unknown') limit 1`;
    if (recurring) throw unconfirmed();
    const terms = {purchaseType:"one_time",automaticRenewal:false,months:plan.months,monthlyMinutes:plan.minutes,amountMinor:plan.amount,currency:"USD",locale,purchaseTermsVersion:8,refundPolicyVersion:4};
    const [created] = await tx<LocalOrder[]>`insert into shorts_mvp.paypal_one_time_orders(user_id,environment,plan_code,locale,status,terms_snapshot) values(${userId},${paypalEnvironment()},${code},${locale},'creating',${JSON.stringify(terms)}::jsonb) returning *`;
    return created;
  });
  if (row.status === "ready" && (row.planCode !== code || Date.now()-new Date(row.createdAt).getTime()>60*60_000)) {
    if (replacements >= 1) throw unconfirmed();
    await cancelOneTimeOrder(userId, row.id, db);
    return prepareOneTimeOrder(userId, code, locale, db, replacements + 1);
  }
  if (row.status === "ready" && row.approvalUrl) return { checkoutId: row.id, approvalUrl: row.approvalUrl };
  const returnUrl = new URL(localizedHref("/billing/paypal/order",row.locale), origin);
  returnUrl.searchParams.set("checkout", row.id);
  const cancelUrl = new URL(returnUrl); cancelUrl.searchParams.set("cancelled", "1");
  try {
    const remote = await paypalRequest<PayPalOrder>("/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: row.id, custom_id: row.id, invoice_id: `EC-${row.id}`,
        description: `${plan.name}: ${plan.months} month(s), ${plan.minutes} minutes/month. One-time payment; no automatic renewal.`,
        amount: { currency_code: "USD", value: (plan.amount / 100).toFixed(2) } }],
      payment_source: { paypal: { experience_context: {
        brand_name: "EasyCut", locale: row.locale === "ja" ? "ja-JP" : "en-US",
        landing_page: "GUEST_CHECKOUT", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW",
        payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED", return_url: returnUrl.toString(), cancel_url: cancelUrl.toString(),
      } } },
    }, { requestId: row.id });
    if(providerId.test(remote.id))await db`update shorts_mvp.paypal_one_time_orders set provider_order_id=${remote.id} where id=${row.id} and status='creating'`;
    const unit = validateOneTimeOrder(remote, row);
    const approval = remote.links?.find(link => ["payer-action", "approve"].includes(link.rel))?.href;
    const url = new URL(approval || "invalid:");
    if (url.protocol !== "https:" || url.hostname !== (paypalEnvironment()==="live"?"www.paypal.com":"www.sandbox.paypal.com") || url.username || url.password) throw Error("Invalid checkout URL");
    await db`update shorts_mvp.paypal_one_time_orders set status='ready',provider_order_id=${remote.id},merchant_id=${unit.payee.merchant_id},approval_url=${url.toString()},updated_at=now() where id=${row.id} and status='creating'`;
    return { checkoutId: row.id, approvalUrl: url.toString() };
  } catch (error) {
    // Do not start another order after an ambiguous create/transport outcome.
    await db`update shorts_mvp.paypal_one_time_orders set status='unknown',updated_at=now() where id=${row.id} and status='creating'`;
    throw error;
  }
}

async function settle(row: LocalOrder, remote: PayPalOrder, db: Db, extraRefund?: Refund) {
  const unit = validateOneTimeOrder(remote, row);
  const captures = unit.payments?.captures || [];
  if (remote.status !== "COMPLETED" || captures.length !== 1) throw unconfirmed();
  // An order approval/browser return is never treated as a settled payment.
  const capture = await paypalRequest<PayPalCapture>(`/v2/payments/captures/${captures[0].id}`);
  const start = validateOneTimeCapture(capture, row, captures[0].id,["COMPLETED","PARTIALLY_REFUNDED","REFUNDED","PENDING","DECLINED","FAILED"]);
  if(capture.status==='PENDING')return {...view(row),providerStatus:'PENDING'};
  if(['DECLINED','FAILED'].includes(capture.status)) {
    await db`update shorts_mvp.paypal_one_time_orders set status='declined',last_checked_at=now(),updated_at=now() where id=${row.id} and capture_id is null`;
    return getOneTimeState(row.userId,row.id,db);
  }
  const plan = paypalPlan(row.planCode), end = addPayPalMonths(start, plan.months);
  const refundIds = new Set((unit.payments?.refunds || []).map(refund=>refund.id));
  if (extraRefund) refundIds.add(extraRefund.id);
  if (refundIds.size>20) throw Error("Incomplete refund history");
  const refunds:Refund[]=[];
  for (const id of refundIds) {
    if (!providerId.test(id)) throw Error("Invalid refund reference");
    const refund=extraRefund?.id===id?extraRefund:await paypalRequest<Refund>(`/v2/payments/refunds/${id}`);
    validateRefund(refund,capture.id,plan.amount);
    if(refund.status==='COMPLETED')refunds.push(refund);
  }
  return db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${row.userId},0))`;
    const [locked] = await tx<LocalOrder[]>`select * from shorts_mvp.paypal_one_time_orders where id=${row.id} for update`;
    if (locked.captureId && locked.captureId !== capture.id) throw Error("Payment ownership mismatch");
    const [account] = await tx`select withdrawn_at from shorts_mvp.app_users where id=${row.userId}`;
    if (!account || (account.withdrawnAt&&!locked.subscriptionId)) throw Error("Account unavailable");
    let subscriptionId = locked.subscriptionId;
    if (!subscriptionId) {
    await tx`update shorts_mvp.user_subscriptions s set status='expired',updated_at=now() where s.user_id=${row.userId} and s.status='active' and s.current_period_end<=now() and exists(select 1 from shorts_mvp.paypal_one_time_orders o where o.subscription_id=s.id and o.environment=${paypalEnvironment()})`;
    await assertNoPayPalBillingConflicts(tx, row.userId);
    subscriptionId = randomUUID();
    await tx`insert into shorts_mvp.user_subscriptions(id,user_id,plan_code,status,billing_cycle,payment_provider,current_period_start,current_period_end,cancel_at_period_end,next_charge_at)
      values(${subscriptionId},${row.userId},${plan.baseCode},'active','monthly','paypal',${start},${end},true,null)`;
    for (let i = 0; i < plan.months; i++) {
      const seconds = plan.minutes * 60;
      const [grant] = await tx`insert into shorts_mvp.usage_grants(user_id,subscription_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,valid_from,expires_at)
        values(${row.userId},${subscriptionId},'base',${plan.baseCode},${seconds},${seconds},0,${addPayPalMonths(start,i)},${addPayPalMonths(start,i+1)}) returning id`;
      await tx`insert into shorts_mvp.paypal_one_time_grants(order_id,grant_id,original_seconds) values(${row.id},${grant.id},${seconds})`;
    }
    }
    for(const refund of refunds) {
      const [known]=await tx`select order_id,amount_minor from shorts_mvp.paypal_one_time_refunds where refund_id=${refund.id}`;
      const amount=usdMinor(refund.amount.value);
      if(known&&(known.orderId!==row.id||Number(known.amountMinor)!==amount))throw Error("Refund ownership mismatch");
      await tx`insert into shorts_mvp.paypal_one_time_refunds(refund_id,order_id,amount_minor) values(${refund.id},${row.id},${amount}) on conflict do nothing`;
    }
    const [sum]=await tx`select coalesce(sum(amount_minor),0)::int as total from shorts_mvp.paypal_one_time_refunds where order_id=${row.id}`;
    if(Number(sum.total)>plan.amount)throw Error("Refund exceeds payment");
    const refunded=capture.status==='REFUNDED'?plan.amount:Math.max(Number(locked.refundedMinor),Number(sum.total));
    const hold=capture.status==='PARTIALLY_REFUNDED'&&refunded===0;
    const grants=await tx`select g.*,m.original_seconds from shorts_mvp.paypal_one_time_grants m join shorts_mvp.usage_grants g on g.id=m.grant_id where m.order_id=${row.id} for update of g`;
    for(const grant of grants) {
      const entitlement=locked.reversed||hold||account.withdrawnAt?0:Math.floor(Number(grant.originalSeconds)*(1-refunded/plan.amount));
      const seconds=Math.max(1,entitlement,Number(grant.consumedSeconds)+Number(grant.reservedSeconds));
      await tx`update shorts_mvp.usage_grants set total_seconds=${seconds},credited_seconds=${seconds},carried_seconds=0,status=${entitlement===0?'revoked':new Date(grant.expiresAt)<=new Date()?'expired':'active'},updated_at=now() where id=${grant.id}`;
    }
    if(refunded>=plan.amount||locked.reversed||account.withdrawnAt)await tx`update shorts_mvp.user_subscriptions set status='canceled',cancel_at_period_end=true,next_charge_at=null,updated_at=now() where id=${subscriptionId}`;
    const [paid] = await tx<LocalOrder[]>`update shorts_mvp.paypal_one_time_orders set status='completed',merchant_id=${unit.payee.merchant_id},capture_id=${capture.id},amount_minor=${plan.amount},currency='USD',subscription_id=${subscriptionId},paid_at=${start},access_end=${end},refunded_minor=${refunded},entitlement_hold=${hold},last_checked_at=now(),last_error_code=null,last_debug_id=null,updated_at=now() where id=${row.id} returning *`;
    return view(paid);
  });
}

export async function confirmOneTimeOrder(userId: string, id: string, db = getDb(), refresh=false, extraRefund?:Refund) {
  let row = await owned(userId, id, db);
  if ((!refresh&&row.status === "completed") || ['canceled','declined'].includes(row.status)) return view(row);
  if (!row.providerOrderId) throw unconfirmed();
  let remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${row.providerOrderId}`);
  const unit=validateOneTimeOrder(remote, row);
  if (remote.status === "COMPLETED") return settle(row, remote, db, extraRefund);
  if (remote.status === 'VOIDED') {
    await db`update shorts_mvp.paypal_one_time_orders set status='canceled',last_checked_at=now(),updated_at=now() where id=${id} and capture_id is null and status='ready'`;
    return getOneTimeState(userId,id,db);
  }
  if (remote.status !== "APPROVED") {
    await db`update shorts_mvp.paypal_one_time_orders set last_checked_at=now() where id=${id}`;
    return { ...view(row), providerStatus: remote.status };
  }
  const claimed = await db.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
    const [current] = await tx<LocalOrder[]>`select * from shorts_mvp.paypal_one_time_orders where id=${id} for update`;
    const retry=['capturing','unknown'].includes(current.status)&&current.captureStartedAt&&Date.now()-new Date(current.captureStartedAt).getTime()<5*60_000&&Date.now()-new Date(current.updatedAt).getTime()>30_000;
    if (current.status !== "ready" && !(current.status==='unknown'&&!current.captureStartedAt) && !retry) return false;
    await tx`update shorts_mvp.paypal_one_time_orders set status='capturing',merchant_id=coalesce(merchant_id,${unit.payee.merchant_id}),capture_started_at=coalesce(capture_started_at,now()),updated_at=now() where id=${id}`;
    return true;
  });
  if (!claimed) throw unconfirmed();
  row = { ...row, status: "capturing" };
  try {
    remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${row.providerOrderId}/capture`, {}, { requestId: `capture-${row.id}` });
    return await settle(row, remote, db);
  } catch (error) {
    await db`update shorts_mvp.paypal_one_time_orders set status='unknown',updated_at=now() where id=${id} and status='capturing'`;
    throw error;
  }
}

function validateRefund(refund:Refund,captureId:string,amount:number) {
  const parent=refund.links?.find(link=>link.rel==='up')?.href;
  const host=paypalEnvironment()==='live'?'api-m.paypal.com':'api-m.sandbox.paypal.com';
  // PayPal also returns the api.paypal.com alias for the same environment.
  const allowed=paypalEnvironment()==='live'?[host,'api.paypal.com']:[host,'api.sandbox.paypal.com'];
  const url=new URL(parent||'invalid:');
  if(!providerId.test(refund.id)||!['COMPLETED','PENDING','FAILED','CANCELLED'].includes(refund.status)||refund.amount?.currency_code!=='USD'
    ||usdMinor(refund.amount.value)<=0||usdMinor(refund.amount.value)>amount||url.protocol!=='https:'||!allowed.includes(url.hostname)
    ||url.username||url.password||url.search||url.hash||url.pathname!==`/v2/payments/captures/${captureId}`)throw Error('Refund mismatch');
}

export async function processOneTimeEvent(event:{event_type:string;resource:{id?:string}},db=getDb()) {
  if(!oneTimeEnabled()||!['CHECKOUT.ORDER.APPROVED','PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.DECLINED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'].includes(event.event_type))return false;
  const id=event.resource.id;if(!id||!providerId.test(id))throw Error('Invalid payment event');
  let orderId=id,captureId:string|undefined,refund:Refund|undefined;
  if(event.event_type==='PAYMENT.CAPTURE.REFUNDED') {
    refund=await paypalRequest<Refund>(`/v2/payments/refunds/${id}`);
    const parent=refund.links?.find(link=>link.rel==='up')?.href;
    captureId=new URL(parent||'invalid:').pathname.split('/').at(-1);
    if(!captureId||!providerId.test(captureId))throw Error('Invalid refund parent');
    validateRefund(refund,captureId,Number.MAX_SAFE_INTEGER);
  } else if(event.event_type.startsWith('PAYMENT.CAPTURE.'))captureId=id;
  let capture:PayPalCapture|undefined;
  if(captureId) {
    capture=await paypalRequest<PayPalCapture>(`/v2/payments/captures/${captureId}`);
    if(capture.id!==captureId)throw Error('Capture identity mismatch');
    orderId=capture.supplementary_data?.related_ids?.order_id||'';
  }
  if(!providerId.test(orderId))throw Error('Invalid order reference');
  const [row]=await db<LocalOrder[]>`select * from shorts_mvp.paypal_one_time_orders where provider_order_id=${orderId} and environment=${paypalEnvironment()}`;
  if(!row)return true; // Another app/payment link on the same merchant account.
  if(['canceled','declined'].includes(row.status))return true;
  if(event.event_type==='PAYMENT.CAPTURE.REVERSED') {
    const remote=await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${orderId}`);
    const unit=validateOneTimeOrder(remote,row);
    if(!unit.payments?.captures?.some(c=>c.id===captureId)||capture?.amount.currency_code!=='USD'||usdMinor(capture.amount.value)!==paypalPlan(row.planCode).amount)throw Error('Reversal mismatch');
    await db.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtextextended(${row.userId},0))`;
      await tx`update shorts_mvp.paypal_one_time_orders set reversed=true,last_checked_at=now(),updated_at=now() where id=${row.id}`;
      await tx`update shorts_mvp.usage_grants g set total_seconds=greatest(1,g.reserved_seconds+g.consumed_seconds),credited_seconds=greatest(1,g.reserved_seconds+g.consumed_seconds),carried_seconds=0,status='revoked',updated_at=now() from shorts_mvp.paypal_one_time_grants m where m.order_id=${row.id} and m.grant_id=g.id`;
      if(row.subscriptionId)await tx`update shorts_mvp.user_subscriptions set status='canceled',cancel_at_period_end=true,next_charge_at=null,updated_at=now() where id=${row.subscriptionId}`;
    });
    return true;
  }
  if(capture&&['DECLINED','FAILED'].includes(capture.status)) {
    await db`update shorts_mvp.paypal_one_time_orders set status='declined',last_checked_at=now(),updated_at=now() where id=${row.id} and capture_id is null`;
    return true;
  }
  if(capture?.status==='PENDING')return true;
  await confirmOneTimeOrder(row.userId,row.id,db,true,refund);
  return true;
}

export async function reconcileOneTimeOrders(db=getDb()) {
  if(!oneTimeEnabled())return {checked:0,failed:0};
  const started=Date.now();let checked=0,failed=0;
  const rows=await db<LocalOrder[]>`select * from shorts_mvp.paypal_one_time_orders where environment=${paypalEnvironment()} and provider_order_id is not null and status not in ('canceled','declined') and (status<>'completed' or access_end>now() or paid_at>now()-interval '180 days') order by last_checked_at asc nulls first,created_at limit 10`;
  for(const row of rows) {
    if(Date.now()-started>45_000)break;checked++;
    try{await confirmOneTimeOrder(row.userId,row.id,db,true);}
    catch(error){failed++;const code=error instanceof HttpError?error.code:'PAYPAL_PROCESSING_FAILED';const debug=(error as {debugId?:string})?.debugId;await db`update shorts_mvp.paypal_one_time_orders set last_checked_at=now(),last_error_code=${code},last_debug_id=${debug&&/^[a-f0-9]{13}$/i.test(debug)?debug:null} where id=${row.id}`;}
  }
  await db`update shorts_mvp.user_subscriptions s set status='expired',updated_at=now() where s.status='active' and s.current_period_end<=now() and exists(select 1 from shorts_mvp.paypal_one_time_orders o where o.subscription_id=s.id and o.environment=${paypalEnvironment()})`;
  return {checked,failed};
}

export async function cancelOneTimeOrder(userId: string, id: string, db = getDb()) {
  const row = await owned(userId, id, db);
  if (row.status === "canceled") return view(row);
  if (row.status !== "ready" || !row.providerOrderId) throw unconfirmed();
  const remote = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${row.providerOrderId}`);
  const unit = validateOneTimeOrder(remote, row);
  if (remote.status === "COMPLETED") return settle(row, remote, db);
  if (!["CREATED", "PAYER_ACTION_REQUIRED", "APPROVED", "VOIDED"].includes(remote.status) || unit.payments?.captures?.length) throw unconfirmed();
  const [canceled] = await db<LocalOrder[]>`update shorts_mvp.paypal_one_time_orders set status='canceled',updated_at=now() where id=${id} and status='ready' returning *`;
  if (!canceled) throw unconfirmed();
  // Orders has no cancel API. This abandons the local order; our capture path
  // refuses it, even if the buyer later approves the old PayPal page.
  return view(canceled);
}
