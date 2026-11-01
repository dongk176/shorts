import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { paypalPlan, addPayPalMonths, usdMinor, type PayPalPlan } from "./catalog";
import { paypalEnabled, paypalEnvironment, paypalPlanId, paypalRequest } from "./api";
import { assertPayPalNewCustomer } from "./eligibility";
type Db = Sql | TransactionSql;
export type PayPalSubscription = { id:string; plan_id:string; custom_id?:string; status:string; quantity?:string; plan_overridden?:boolean; create_time:string; status_update_time?:string; billing_info?:{next_billing_time?:string}; links?:{rel:string;href:string}[] };
type Transaction = { id:string; status:string; time:string; amount_with_breakdown:{gross_amount:{currency_code:string;value:string}} };
type Checkout = {id:string;userId:string;planCode:string;providerPlanId:string;environment:string;providerSubscriptionId:string|null;status:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const subscriptionId=/^I-[A-Z0-9]{8,32}$/;
export function validatePayPalPlan(remote: {id:string;product_id:string;status:string;billing_cycles:{tenure_type:string;frequency:{interval_unit:string;interval_count:number};total_cycles:number;pricing_scheme:{fixed_price:{currency_code:string;value:string}}}[];payment_preferences?:{setup_fee?:{currency_code:string;value:string}};taxes?:{percentage?:string}}, plan:PayPalPlan, id:string) {
  const cycle=remote.billing_cycles?.[0];
  const productId=plan.code.startsWith("starter_")?"PROD-2W975416W47409145":plan.code.startsWith("expert_")?"PROD-4M935244FP7175734":"PROD-9EP98164RL252920V";
  if(remote.id!==id || remote.product_id!==productId || remote.status!=="ACTIVE" || remote.billing_cycles.length!==1 || cycle.tenure_type!=="REGULAR" || cycle.frequency.interval_unit!=="MONTH" || cycle.frequency.interval_count!==plan.months || cycle.total_cycles!==0 || cycle.pricing_scheme.fixed_price.currency_code!=="USD" || usdMinor(cycle.pricing_scheme.fixed_price.value)!==plan.amount || (remote.payment_preferences?.setup_fee && usdMinor(remote.payment_preferences.setup_fee.value)!==0) || Number(remote.taxes?.percentage??0)!==0)throw Error("PayPal catalog mismatch");
}
export function validatePayPalSubscription(sub:PayPalSubscription, checkout:Checkout) {
  if(!subscriptionId.test(sub.id) || sub.custom_id!==checkout.id || sub.plan_id!==checkout.providerPlanId || sub.plan_overridden || (sub.quantity && sub.quantity!=="1") || !["APPROVAL_PENDING","APPROVED","ACTIVE","SUSPENDED","CANCELLED","EXPIRED"].includes(sub.status) || !Number.isFinite(Date.parse(sub.create_time)))throw Error("PayPal subscription mismatch");
  if(checkout.providerSubscriptionId && checkout.providerSubscriptionId!==sub.id)throw Error("PayPal subscription ownership mismatch");
}
export function validatePayPalPayment(t:Transaction, plan:PayPalPlan) {
  if(!/^[A-Z0-9]{10,32}$/.test(t.id) || t.status!=="COMPLETED" || t.amount_with_breakdown?.gross_amount.currency_code!=="USD" || usdMinor(t.amount_with_breakdown.gross_amount.value)!==plan.amount || !Number.isFinite(Date.parse(t.time)))throw Error("PayPal payment mismatch");
  return new Date(t.time);
}
async function noConflicts(tx:Db,userId:string) {
  await assertPayPalNewCustomer(userId,tx);
  const [active]=await tx`select id from shorts_mvp.user_subscriptions where user_id=${userId} and status in ('pending','trialing','active','past_due') and (current_period_end is null or current_period_end>now() or cancel_at_period_end=false) limit 1`;
  const [order]=await tx`select id from shorts_mvp.billing_orders where user_id=${userId} and (status in ('processing','unknown','manual_review') or (status='pending' and (checkout_expires_at is null or checkout_expires_at>now()))) limit 1`;
  const [toss]=await tx`select id from shorts_mvp.billing_toss_checkout_intents where user_id=${userId} and status in ('pending','processing','unknown','manual_review') and (expires_at is null or expires_at>now()) limit 1`;
  const [paddle]=await tx`select id from shorts_mvp.paddle_checkouts where user_id=${userId} and status in ('creating','ready','unknown') limit 1`;
  if(active||order||toss||paddle)throw new HttpError(409,"An existing subscription or payment must be resolved first.","EXISTING_SUBSCRIPTION");
}
export async function preparePayPalCheckout(userId:string,code:string,locale:"en"|"ja",db=getDb()) {
  if(!paypalEnabled())throw new HttpError(503,"PayPal is unavailable.");
  const plan=paypalPlan(code), planId=paypalPlanId(code), environment=paypalEnvironment();
  // Validate the actual merchant plan before a buyer is sent to a payable checkout.
  const remote=await paypalRequest<Parameters<typeof validatePayPalPlan>[0]>(`/v1/billing/plans/${planId}`);
  validatePayPalPlan(remote,plan,planId);
  const checkout=await db.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
    await assertPayPalNewCustomer(userId,tx);
    const [existing]=await tx<Checkout[]>`select * from shorts_mvp.paypal_checkouts where user_id=${userId} and environment=${environment} and status in ('creating','ready','unknown') order by created_at desc limit 1 for update`;
    if(existing) {
      if(existing.planCode!==code || existing.status!=="ready")throw new HttpError(409,"Resolve the previous checkout first.","CHECKOUT_UNCONFIRMED");
      return existing;
    }
    await noConflicts(tx,userId);
    const [row]=await tx<Checkout[]>`insert into shorts_mvp.paypal_checkouts(user_id,environment,plan_code,provider_plan_id,locale) values(${userId},${environment},${code},${planId},${locale}) returning *`;
    return row;
  });
  if(checkout.providerSubscriptionId) {
    const sub=await paypalRequest<PayPalSubscription>(`/v1/billing/subscriptions/${checkout.providerSubscriptionId}`);
    validatePayPalSubscription(sub,checkout);
    const href=sub.links?.find(l=>l.rel==="approve")?.href;
    if(href && sub.status==="APPROVAL_PENDING")return {checkoutId:checkout.id,approvalUrl:approvalUrl(href)};
    await syncPayPalSubscription(sub.id,db);
    throw new HttpError(409,"The previous checkout is being confirmed.","CHECKOUT_UNCONFIRMED");
  }
  try {
    const origin=process.env.PAYPAL_RETURN_ORIGIN || "https://www.easycut.co.kr";
    if(!/^https:\/\/([a-z0-9-]+\.)*(easycut\.co\.kr|vercel\.app)$/.test(origin))throw Error("Invalid PayPal return origin");
    const prefix=locale==="ja"?"/jp":"/en";
    const sub=await paypalRequest<PayPalSubscription>("/v1/billing/subscriptions",{plan_id:planId,custom_id:checkout.id,quantity:"1",application_context:{brand_name:"EasyCut",locale:locale==="ja"?"ja-JP":"en-US",shipping_preference:"NO_SHIPPING",user_action:"SUBSCRIBE_NOW",return_url:`${origin}${prefix}/billing/paypal?checkout=${checkout.id}`,cancel_url:`${origin}${prefix}/billing/paypal?checkout=${checkout.id}&cancelled=1`}},{requestId:checkout.id});
    validatePayPalSubscription(sub,checkout);
    const link=sub.links?.find(l=>l.rel==="approve")?.href;
    if(!link)throw Error("Missing approval link");
    const url=approvalUrl(link);
    await db`update shorts_mvp.paypal_checkouts set provider_subscription_id=${sub.id},status='ready',updated_at=now() where id=${checkout.id}`;
    return {checkoutId:checkout.id,approvalUrl:url};
  } catch(error) {
    await db`update shorts_mvp.paypal_checkouts set status='unknown',updated_at=now() where id=${checkout.id} and status='creating'`;
    throw error;
  }
}
function approvalUrl(value:string) {
  const url=new URL(value),host=paypalEnvironment()==="live"?"www.paypal.com":"www.sandbox.paypal.com";
  if(url.protocol!=="https:" || url.hostname!==host || url.username || url.password)throw Error("Invalid approval URL");
  return value;
}
export async function syncPayPalSubscription(id:string,db=getDb()) {
  if(!subscriptionId.test(id))throw Error("Invalid PayPal subscription ID");
  const sub=await paypalRequest<PayPalSubscription>(`/v1/billing/subscriptions/${id}`);
  if(!uuid.test(sub.custom_id??""))throw Error("Unmapped PayPal subscription");
  const [checkout]=await db<Checkout[]>`select * from shorts_mvp.paypal_checkouts where id=${sub.custom_id!}`;
  if(!checkout || checkout.environment!==paypalEnvironment())throw Error("Unmapped PayPal subscription");
  validatePayPalSubscription(sub,checkout);
  const plan=paypalPlan(checkout.planCode);
  // Recent transaction history is independently read from PayPal, not browser or webhook claims.
  const from=new Date(Math.max(Date.parse(sub.create_time)-60000,Date.now()-179*86400000));
  const query=new URLSearchParams({start_time:from.toISOString(),end_time:new Date(Date.now()+60000).toISOString()});
  const history=await paypalRequest<{transactions?:Transaction[];total_items?:number}>(`/v1/billing/subscriptions/${id}/transactions?${query}`);
  // PayPal returns HTTP 200 with {} when the requested range has no transactions,
  // including the short interval between buyer approval and payment-history availability.
  // No transaction means no allowance; retry canonical lookup when history catches up.
  const listed=history.transactions ?? (Object.keys(history).length===0?[]:undefined);
  if(!Array.isArray(listed) || listed.length>100 || Number(history.total_items??listed.length)>listed.length)throw Error("Incomplete PayPal payment history");
  const completed=listed.filter(t=>t.status==="COMPLETED").sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  for(const t of completed)validatePayPalPayment(t,plan);
  return db.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtextextended(${checkout.userId},0))`;
    const [account]=await tx`select withdrawn_at from shorts_mvp.app_users where id=${checkout.userId}`;
    if(!account || account.withdrawnAt)throw Error("Account unavailable");
    const [locked]=await tx<Checkout[]>`select * from shorts_mvp.paypal_checkouts where id=${checkout.id} for update`;
    validatePayPalSubscription(sub,locked);
    let [mapped]=await tx`select * from shorts_mvp.paypal_subscriptions where paypal_id=${id} for update`;
    if(mapped && (mapped.userId!==checkout.userId || mapped.checkoutId!==checkout.id))throw Error("Subscription ownership mismatch");
    if(!mapped) {
      const [row]=await tx`insert into shorts_mvp.paypal_subscriptions(paypal_id,user_id,checkout_id,environment,provider_status) values(${id},${checkout.userId},${checkout.id},${checkout.environment},${sub.status}) returning *`;
      mapped=row;
    }
    for(const t of completed) {
      const [known]=await tx`select paypal_subscription_id from shorts_mvp.paypal_payments where transaction_id=${t.id}`;
      if(known) {if(known.paypalSubscriptionId!==id)throw Error("Payment ownership mismatch");continue;}
      if(!mapped.subscriptionId) {
        await noConflicts(tx,checkout.userId);
        const local=randomUUID();
        await tx`insert into shorts_mvp.user_subscriptions(id,user_id,plan_code,status,billing_cycle,payment_provider) values(${local},${checkout.userId},${plan.baseCode},'active','monthly','paypal')`;
        await tx`update shorts_mvp.paypal_subscriptions set subscription_id=${local} where paypal_id=${id}`;
        mapped.subscriptionId=local;
      }
      const paidAt=validatePayPalPayment(t,plan);
      const [previous]=await tx`select period_end from shorts_mvp.paypal_payments where paypal_subscription_id=${id} order by period_end desc limit 1`;
      // Provider retries can settle a few days late. Anchor renewals to the paid-through boundary
      // so granting allowance never drifts or overlaps due to retry timestamps.
      const boundary=previous?new Date(previous.periodEnd):null;
      const start=boundary && Math.abs(+boundary-+paidAt)<=3*86400000?boundary:paidAt;
      const end=addPayPalMonths(start,plan.months);
      // Never issue overlapping paid periods, including duplicate/late provider charges.
      const [overlap]=await tx`select transaction_id from shorts_mvp.paypal_payments where paypal_subscription_id=${id} and period_start<${end} and period_end>${start} limit 1`;
      if(overlap)throw Error("Overlapping PayPal paid period requires review");
      await tx`insert into shorts_mvp.paypal_payments(transaction_id,user_id,paypal_subscription_id,currency,amount_minor,period_start,period_end,plan_code) values(${t.id},${checkout.userId},${id},'USD',${plan.amount},${start},${end},${checkout.planCode})`;
      for(let i=0;i<plan.months;i++) {
        const valid=addPayPalMonths(start,i),expires=addPayPalMonths(start,i+1),seconds=plan.minutes*60;
        const [grant]=await tx`insert into shorts_mvp.usage_grants(user_id,subscription_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,valid_from,expires_at) values(${checkout.userId},${mapped.subscriptionId},'base',${plan.baseCode},${seconds},${seconds},0,${valid},${expires}) returning id`;
        await tx`insert into shorts_mvp.paypal_payment_grants(transaction_id,grant_id,original_seconds) values(${t.id},${grant.id},${seconds})`;
      }
      await tx`update shorts_mvp.user_subscriptions set current_period_start=${start},current_period_end=${end},updated_at=now() where id=${mapped.subscriptionId} and (current_period_end is null or current_period_end<${end})`;
    }
    // Canonical lookup makes delayed/out-of-order notifications harmless. Cancellation stops renewal,
    // while already paid monthly grants remain usable until their own expiry.
    await tx`update shorts_mvp.paypal_subscriptions set provider_status=${sub.status},updated_at=now(),last_checked_at=now() where paypal_id=${id}`;
    if(mapped.subscriptionId) await tx`update shorts_mvp.user_subscriptions set cancel_at_period_end=${["CANCELLED","EXPIRED"].includes(sub.status)},next_charge_at=${sub.billing_info?.next_billing_time??null},status=case when current_period_end<=now() and ${["CANCELLED","EXPIRED"].includes(sub.status)} then 'expired' else 'active' end,updated_at=now() where id=${mapped.subscriptionId}`;
    await tx`update shorts_mvp.paypal_checkouts set provider_subscription_id=${id},status=${mapped.subscriptionId?"completed":["CANCELLED","EXPIRED"].includes(sub.status)?"canceled":"ready"},updated_at=now() where id=${checkout.id}`;
    return {status:sub.status,paid:Boolean(mapped.subscriptionId)};
  });
}
export async function getPayPalState(userId:string,db=getDb()) {
  const [row]=await db`select ps.paypal_id,ps.provider_status,c.plan_code,s.current_period_end,s.cancel_at_period_end from shorts_mvp.paypal_subscriptions ps join shorts_mvp.paypal_checkouts c on c.id=ps.checkout_id left join shorts_mvp.user_subscriptions s on s.id=ps.subscription_id where ps.user_id=${userId} and ps.environment=${paypalEnvironment()} order by ps.created_at desc limit 1`;
  return row?{id:row.paypalId as string,status:row.providerStatus as string,planCode:row.planCode as string,currentPeriodEnd:row.currentPeriodEnd?new Date(row.currentPeriodEnd).toISOString():null,cancelAtPeriodEnd:Boolean(row.cancelAtPeriodEnd)}:null;
}
export async function confirmPayPalCheckout(userId:string,checkoutId:string,db=getDb()) {
  const [c]=await db<Checkout[]>`select * from shorts_mvp.paypal_checkouts where id=${checkoutId} and user_id=${userId} and environment=${paypalEnvironment()}`;
  if(!c?.providerSubscriptionId)throw new HttpError(404,"Checkout not found.");
  await syncPayPalSubscription(c.providerSubscriptionId,db);
  return getPayPalState(userId,db);
}
export async function cancelPayPalSubscription(userId:string,db=getDb()) {
  const state=await getPayPalState(userId,db);
  if(!state)throw new HttpError(404,"Subscription not found.");
  if(!["CANCELLED","EXPIRED"].includes(state.status)) await paypalRequest(`/v1/billing/subscriptions/${state.id}/cancel`,{reason:"Customer requested cancellation through EasyCut."});
  await syncPayPalSubscription(state.id,db);
}
export async function cancelPayPalCheckout(userId:string,checkoutId:string,db=getDb()) {
  const [c]=await db<Checkout[]>`select * from shorts_mvp.paypal_checkouts where id=${checkoutId} and user_id=${userId} and environment=${paypalEnvironment()}`;
  if(!c || c.status==="completed")throw new HttpError(409,"Checkout cannot be canceled.");
  if(!c.providerSubscriptionId)throw new HttpError(409,"Checkout needs support review.");
  const sub=await paypalRequest<PayPalSubscription>(`/v1/billing/subscriptions/${c.providerSubscriptionId}`);
  validatePayPalSubscription(sub,c);
  if(sub.status==="ACTIVE")throw new HttpError(409,"Confirm this subscription before canceling.");
  if(!["CANCELLED","EXPIRED"].includes(sub.status)) await paypalRequest(`/v1/billing/subscriptions/${sub.id}/cancel`,{reason:"Customer abandoned checkout."});
  await syncPayPalSubscription(sub.id,db);
}
export async function reconcilePayPal(db=getDb()) {
  if(!paypalEnabled())return {checked:0,failed:0};
  const rows=await db`select c.provider_subscription_id as paypal_id from shorts_mvp.paypal_checkouts c left join shorts_mvp.paypal_subscriptions s on s.paypal_id=c.provider_subscription_id
 where c.environment=${paypalEnvironment()} and c.provider_subscription_id is not null and (s.paypal_id is null or s.provider_status not in ('CANCELLED','EXPIRED')) order by s.last_checked_at asc nulls first limit 10`;
  let failed=0;
  for(const r of rows){try{await syncPayPalSubscription(r.paypalId,db);}catch{failed++;}}
  return {checked:rows.length,failed};
}
