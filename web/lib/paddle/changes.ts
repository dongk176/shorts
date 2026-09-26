import type { TransactionSql } from 'postgres';
import { getDb } from '@/lib/db';
import { HttpError } from '@/lib/http';
import { paddleRequest } from './api';
import { assertPaddleEnabled, paddleEnvironment, paddlePriceId } from './config';
import { paddlePlan, type PaddleCurrency } from './catalog';
import { changeTiming, changePayload, assertUpgradeAmount } from './change-policy';
import type { PaddleSubscription, PaddleTransaction } from './models';

type ChangeRow = {
 id: string; userId: string; paddleSubscriptionId: string; fromCode: string; toCode: string;
 currency: PaddleCurrency; timing: 'immediate'|'renewal'; status: string;
 sourceUpdatedAt: Date; periodStart: Date; periodEnd: Date; effectiveAt: Date;
 amountMinor: number; expiresAt: Date; transactionId: string|null;
 cancelRequestedAt: Date|null; canceledAt: Date|null;
};
type Preview = Pick<PaddleSubscription,'items'|'next_billed_at'> & {
 currency_code: string; immediate_transaction: PaddleTransaction|null;
 next_transaction: {billing_period:{starts_at:string;ends_at:string}}|null;
};
const conflict = () => new HttpError(409,'Subscription changed. Refresh and try again.','CHANGE_CONFLICT');
export function publicChange(row: ChangeRow) {
 return {id:row.id,planCode:row.toCode,timing:row.timing,status:row.cancelRequestedAt && !row.canceledAt && row.status==='unknown'?'canceling':row.status,currency:row.currency,
   amountMinor:Number(row.amountMinor),effectiveAt:new Date(row.effectiveAt).toISOString()};
}
function sameInstant(a: string|Date|null, b: string|Date) {return a !== null && +new Date(a) === +new Date(b);}
function checkSub(sub: PaddleSubscription, row: {paddleId:string;customerId:string;planCode:string;currentPeriodEnd:Date}, currency: PaddleCurrency) {
 if (sub.id!==row.paddleId || sub.customer_id!==row.customerId || sub.status!=='active' || sub.scheduled_change ||
     sub.items.length!==1 || sub.items[0].quantity!==1 || sub.items[0].price.id!==paddlePriceId(row.planCode,currency) ||
     !sameInstant(sub.next_billed_at,row.currentPeriodEnd) || +new Date(row.currentPeriodEnd)-Date.now()<35*60000)
   throw conflict();
}
async function previewChange(subId:string,from:string,to:string,currency:PaddleCurrency,end:Date) {
 const timing=changeTiming(from,to);
 const result=await paddleRequest<Preview>(`/subscriptions/${subId}/preview`,changePayload(from,to,paddlePriceId(to,currency)),'PATCH');
 if(result.currency_code!==currency || result.items.length!==1 || result.items[0].price.id!==paddlePriceId(to,currency) ||
    (timing==='immediate' && !sameInstant(result.next_billed_at,end))) throw new Error('Unexpected subscription preview');
 if(timing==='renewal') {
   if(result.immediate_transaction!==null || (paddlePlan(from).billingMonths===paddlePlan(to).billingMonths && !sameInstant(result.next_transaction?.billing_period.starts_at??null,end)))
     throw new Error('Deferred change would charge now or change renewal');
   return {amount:0,effective:end};
 }
 const transaction=result.immediate_transaction;
 if(!transaction?.billing_period || !sameInstant(transaction.billing_period.ends_at,end)) throw new Error('Invalid upgrade preview');
 const amount=Number(transaction.details.totals.total);
 assertUpgradeAmount(amount,from,to,currency);
 return {amount,effective:new Date(transaction.billing_period.starts_at)};
}
export async function quotePaddleChange(userId:string,to:string,db=getDb()) {
 assertPaddleEnabled(); paddlePlan(to);
 return db.begin(async tx=>{
   await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
   const [row]=await tx`select ps.*,s.plan_code,s.current_period_start,s.current_period_end from shorts_mvp.paddle_subscriptions ps
     join shorts_mvp.user_subscriptions s on s.id=ps.subscription_id join shorts_mvp.app_users u on u.id=ps.user_id
     where ps.user_id=${userId} and ps.environment=${paddleEnvironment()} and u.withdrawn_at is null and s.status='active'
     order by ps.created_at desc limit 1`;
   if(!row || row.planCode===to) throw conflict();
   const [pending]=await tx`select id from shorts_mvp.paddle_plan_changes where paddle_subscription_id=${row.paddleId} and status in ('processing','unknown','scheduled')`;
   if(pending) throw new HttpError(409,'A change is already pending.','CHANGE_PENDING');
   const [paid]=await tx`select currency from shorts_mvp.paddle_payments where paddle_subscription_id=${row.paddleId} order by period_end desc,created_at desc limit 1`;
   if(!paid || !['USD','JPY'].includes(paid.currency)) throw conflict();
   const currency=paid.currency as PaddleCurrency;
   const sub=await paddleRequest<PaddleSubscription>(`/subscriptions/${row.paddleId}`);
   checkSub(sub,row as Parameters<typeof checkSub>[1],currency);
   const preview=await previewChange(row.paddleId,row.planCode,to,currency,new Date(row.currentPeriodEnd));
   const [quote]=await tx<ChangeRow[]>`insert into shorts_mvp.paddle_plan_changes(user_id,paddle_subscription_id,from_code,to_code,currency,timing,status,
     source_updated_at,period_start,period_end,effective_at,amount_minor,expires_at)
     values(${userId},${row.paddleId},${row.planCode},${to},${currency},${changeTiming(row.planCode,to)},'quoted',${sub.updated_at},
       ${row.currentPeriodStart},${row.currentPeriodEnd},${preview.effective},${preview.amount},${new Date(Date.now()+5*60000)}) returning *`;
   return publicChange(quote);
 });
}
export async function confirmPaddleChange(userId:string,id:string,db=getDb()) {
 assertPaddleEnabled();
 // Persist the operation before contacting Paddle. A timeout must never make a charge retryable.
 const row=await db.begin(async tx=>{
   await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
   const [quote]=await tx<ChangeRow[]>`select c.* from shorts_mvp.paddle_plan_changes c join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=c.paddle_subscription_id
     where c.id=${id} and c.user_id=${userId} and ps.environment=${paddleEnvironment()} for update of c`;
   if(!quote) throw new HttpError(404,'Change not found.');
   if(quote.status!=='quoted') return quote;
   if(new Date(quote.expiresAt).getTime()<=Date.now()) throw conflict();
   const [pending]=await tx`select id from shorts_mvp.paddle_plan_changes where paddle_subscription_id=${quote.paddleSubscriptionId} and status in ('processing','unknown','scheduled')`;
   if(pending) throw conflict();
   const [owner]=await tx`select ps.paddle_id,ps.customer_id,s.plan_code,s.current_period_end from shorts_mvp.paddle_subscriptions ps
     join shorts_mvp.user_subscriptions s on s.id=ps.subscription_id join shorts_mvp.app_users u on u.id=ps.user_id
     where ps.paddle_id=${quote.paddleSubscriptionId} and u.withdrawn_at is null and s.status='active'`;
   if(!owner || owner.planCode!==quote.fromCode) throw conflict();
   const sub=await paddleRequest<PaddleSubscription>(`/subscriptions/${quote.paddleSubscriptionId}`);
   checkSub(sub,owner as Parameters<typeof checkSub>[1],quote.currency);
   if(!sameInstant(sub.updated_at,quote.sourceUpdatedAt)) throw conflict();
   const fresh=await previewChange(sub.id,quote.fromCode,quote.toCode,quote.currency,new Date(quote.periodEnd));
   if(fresh.amount>Number(quote.amountMinor)) throw conflict();
   const [claimed]=await tx<ChangeRow[]>`update shorts_mvp.paddle_plan_changes set status='processing',effective_at=${fresh.effective},updated_at=now() where id=${id} returning *`;
   return claimed;
 });
 // Only the request that claimed the operation may dispatch it.
 // A repeat sees processing but must not send again (claim is tracked below by dispatch flag).
 return dispatchChange(row,userId,db);
}
async function dispatchChange(row:ChangeRow,userId:string,db:ReturnType<typeof getDb>) {
 // A durable single dispatch marker also serializes two requests with the same quote ID.
 const claimed=await db`update shorts_mvp.paddle_plan_changes set status='unknown',updated_at=now()
   where id=${row.id} and user_id=${userId} and status='processing' returning id`;
 if(!claimed.length) return publicChange(row);
 try {
   if(row.timing==='renewal') return publicChange(await reconcileRenewalChange(row.id,db));
   const result=await paddleRequest<PaddleSubscription>(`/subscriptions/${row.paddleSubscriptionId}`,{
     ...changePayload(row.fromCode,row.toCode,paddlePriceId(row.toCode,row.currency)),
     custom_data:{easycut_change_id:row.id},
   },'PATCH');
   if(result.id!==row.paddleSubscriptionId || result.status!=='active' || result.items.length!==1 ||
      result.items[0].price.id!==paddlePriceId(row.toCode,row.currency) || !sameInstant(result.next_billed_at,row.periodEnd))
     throw new Error('Unconfirmed change');
   // Paid immediate changes are applied ONLY by the canonical completed transaction webhook.

   const [updated]=await db<ChangeRow[]>`select * from shorts_mvp.paddle_plan_changes where id=${row.id}`;
   return publicChange(updated);
 } catch {
   throw new HttpError(503,'Change is being confirmed. Do not repeat payment.','CHANGE_UNCONFIRMED');
 }
}


/** Both writes are do_not_bill. Changing frequency resets Paddle's billing date,
 * so restore the already-paid boundary in a separate update. Retry only this
 * no-charge workflow after reading the canonical subscription. Never retry upgrades. */
export async function reconcileRenewalChange(id:string,db=getDb()) {
 return db.begin(async tx=>{
  const [before]=await tx<ChangeRow[]>`select * from shorts_mvp.paddle_plan_changes where id=${id}`;
  if(!before) throw Error('Missing change');
  await tx`select pg_advisory_xact_lock(hashtextextended(${before.userId},0))`;
  const [row]=await tx<ChangeRow[]>`select * from shorts_mvp.paddle_plan_changes where id=${id} for update`;
  if(row.timing!=='renewal' || !['processing','unknown'].includes(row.status)) return row;
  const [owner]=await tx`select * from shorts_mvp.paddle_subscriptions where paddle_id=${row.paddleSubscriptionId} and user_id=${row.userId} and environment=${paddleEnvironment()}`;
  if(!owner) throw Error('Change owner mismatch');
  let sub=await paddleRequest<PaddleSubscription>(`/subscriptions/${row.paddleSubscriptionId}`);
  if(sub.customer_id!==owner.customerId || sub.id!==row.paddleSubscriptionId || sub.items.length!==1 || sub.items[0].quantity!==1) throw Error('Change ownership mismatch');
  if(sub.status==='canceled') {
    const [stopped]=await tx<ChangeRow[]>`update shorts_mvp.paddle_plan_changes set status='superseded',updated_at=now() where id=${id} returning *`;
    return stopped;
  }
  if(sub.status!=='active' || sub.scheduled_change || +new Date(row.periodEnd)-Date.now()<35*60000) throw Error('Change requires review');
  if(row.cancelRequestedAt) return reconcileCancellation(tx,row,sub);
  const oldPrice=paddlePriceId(row.fromCode,row.currency),price=paddlePriceId(row.toCode,row.currency);
  if(sub.items[0].price.id===oldPrice) {
    if(!sameInstant(sub.updated_at,row.sourceUpdatedAt) || !sameInstant(sub.next_billed_at,row.periodEnd)) throw Error('Stale renewal change');
    sub=await paddleRequest<PaddleSubscription>(`/subscriptions/${sub.id}`,{
      items:[{price_id:price,quantity:1}],proration_billing_mode:'do_not_bill',on_payment_failure:'prevent_change',custom_data:{easycut_change_id:row.id},
    },'PATCH');
  }
  if(sub.items.length!==1 || sub.items[0].price.id!==price || sub.custom_data?.easycut_change_id!==row.id) throw Error('Unconfirmed target');
  if(!sameInstant(sub.next_billed_at,row.periodEnd)) {
    // Preflight date-only change separately; there must be no immediate transaction.
    const body={next_billed_at:new Date(row.periodEnd).toISOString(),proration_billing_mode:'do_not_bill',on_payment_failure:'prevent_change'};
    const preview=await paddleRequest<Preview>(`/subscriptions/${sub.id}/preview`,body,'PATCH');
    if(preview.immediate_transaction!==null || !sameInstant(preview.next_billed_at,row.periodEnd)) throw Error('Renewal date preview mismatch');
    sub=await paddleRequest<PaddleSubscription>(`/subscriptions/${sub.id}`,body,'PATCH');
  }
  if(!sameInstant(sub.next_billed_at,row.periodEnd) || sub.items[0]?.price.id!==price) throw Error('Renewal date unconfirmed');
  const [saved]=await tx<ChangeRow[]>`update shorts_mvp.paddle_plan_changes set status='scheduled',updated_at=now() where id=${id} returning *`;
  return saved;
 });
}
export async function reconcilePendingPaddleChanges(db=getDb()) {
 assertPaddleEnabled();
 const rows=await db`select c.id from shorts_mvp.paddle_plan_changes c join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=c.paddle_subscription_id
   where ps.environment=${paddleEnvironment()} and c.timing='renewal' and c.status in ('processing','unknown') and c.updated_at<now()-interval '2 minutes'
   order by c.updated_at limit 5`;
 let failures=0;
 for(const row of rows) {try {await reconcileRenewalChange(row.id,db);}catch {failures++;}}
 return {checked:rows.length,failures};
}

/** Claim cancellation durably before touching Paddle. Retries recover only do_not_bill writes. */
export async function cancelPaddleChange(userId:string,id:string,db=getDb()) {
 assertPaddleEnabled();
 const row=await db.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended(${userId},0))`;
  const [c]=await tx<ChangeRow[]>`select c.* from shorts_mvp.paddle_plan_changes c
   join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=c.paddle_subscription_id
   join shorts_mvp.app_users u on u.id=c.user_id
   where c.id=${id} and c.user_id=${userId} and ps.environment=${paddleEnvironment()} and u.withdrawn_at is null for update of c`;
  if(!c) throw new HttpError(404,'Change not found.');
  if(c.canceledAt || (c.cancelRequestedAt && c.status==='unknown')) return c;
  if(c.timing!=='renewal' || c.status!=='scheduled' || +new Date(c.periodEnd)-Date.now()<35*60000) throw conflict();
  const [owner]=await tx`select s.plan_code,s.current_period_end from shorts_mvp.paddle_subscriptions ps
   join shorts_mvp.user_subscriptions s on s.id=ps.subscription_id where ps.paddle_id=${c.paddleSubscriptionId} and s.status='active'`;
  if(!owner || owner.planCode!==c.fromCode || !sameInstant(owner.currentPeriodEnd,c.periodEnd)) throw conflict();
  const [claimed]=await tx<ChangeRow[]>`update shorts_mvp.paddle_plan_changes set cancel_requested_at=now(),status='unknown',updated_at=now() where id=${id} returning *`;
  return claimed;
 });
 if(row.canceledAt) return publicChange(row);
 try {return publicChange(await reconcileRenewalChange(id,db));}
 catch {throw new HttpError(503,'Cancellation is being confirmed.','CHANGE_UNCONFIRMED');}
}
async function reconcileCancellation(tx:TransactionSql,row:ChangeRow,initial:PaddleSubscription) {
 let sub=initial;
 const price=paddlePriceId(row.fromCode,row.currency),target=paddlePriceId(row.toCode,row.currency);
 if(sub.custom_data?.easycut_change_id!==row.id) throw Error('Cancellation marker mismatch');
 if(sub.items[0].price.id===target) {
  if(!sameInstant(sub.next_billed_at,row.periodEnd)) throw Error('Cancellation date changed');
  const body={items:[{price_id:price,quantity:1}],proration_billing_mode:'do_not_bill',on_payment_failure:'prevent_change',
   custom_data:{...sub.custom_data,easycut_change_id:row.id,easycut_change_canceled:row.id}};
  const preview=await paddleRequest<Preview>(`/subscriptions/${sub.id}/preview`,body,'PATCH');
  if(preview.immediate_transaction!==null || preview.items.length!==1 || preview.items[0].price.id!==price) throw Error('Cancellation preview mismatch');
  sub=await paddleRequest<PaddleSubscription>(`/subscriptions/${sub.id}`,body,'PATCH');
 }
 if(sub.items.length!==1 || sub.items[0].price.id!==price || sub.custom_data?.easycut_change_canceled!==row.id) throw Error('Cancellation unconfirmed');
 if(!sameInstant(sub.next_billed_at,row.periodEnd)) {
  const body={next_billed_at:new Date(row.periodEnd).toISOString(),proration_billing_mode:'do_not_bill',on_payment_failure:'prevent_change'};
  const preview=await paddleRequest<Preview>(`/subscriptions/${sub.id}/preview`,body,'PATCH');
  if(preview.immediate_transaction!==null || !sameInstant(preview.next_billed_at,row.periodEnd)) throw Error('Cancellation boundary mismatch');
  sub=await paddleRequest<PaddleSubscription>(`/subscriptions/${sub.id}`,body,'PATCH');
 }
 if(!sameInstant(sub.next_billed_at,row.periodEnd) || sub.items[0]?.price.id!==price) throw Error('Cancellation boundary unconfirmed');
 const [saved]=await tx<ChangeRow[]>`update shorts_mvp.paddle_plan_changes set status='superseded',canceled_at=now(),updated_at=now() where id=${row.id} returning *`;
 return saved;
}
