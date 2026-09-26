import type { Sql, TransactionSql } from 'postgres';
import { paddlePlan, paddleAmount, type PaddleCurrency } from './catalog';
import { paddlePriceId, paddleEnvironment } from './config';
import { upgradeAllowances } from './change-policy';
import type { PaddleTransaction,PaddleSubscription } from './models';
type Db=Sql|TransactionSql;

export async function applyPaddleUpgrade(tx:Db,t:PaddleTransaction,sub:PaddleSubscription|null,
 mapped:{subscriptionId:string;userId:string;customerId:string;environment:string;paddleId:string}) {
 if(t.origin!=='subscription_update') return false;
 const [change]=await tx`select * from shorts_mvp.paddle_plan_changes where id=${t.custom_data?.easycut_change_id ?? '00000000-0000-0000-0000-000000000000'}
   and paddle_subscription_id=${mapped.paddleId} for update`;
 if(!change || change.timing!=='immediate' || !['processing','unknown','applied'].includes(change.status) ||
   change.userId!==mapped.userId || mapped.environment!==paddleEnvironment() ||
   t.customer_id!==mapped.customerId || sub?.id!==mapped.paddleId || sub.customer_id!==mapped.customerId ||
   t.currency_code!==change.currency || (change.transactionId && change.transactionId!==t.id)) throw Error('Unexpected upgrade transaction');
 const [existing]=await tx`select transaction_id from shorts_mvp.paddle_payments where transaction_id=${t.id}`;
 if(existing) return true;
 const currency=change.currency as PaddleCurrency;
 const price=paddlePriceId(change.toCode,currency),oldPrice=paddlePriceId(change.fromCode,currency);
 const amount=Number(t.details.totals.total),principal=Number(t.details.totals.subtotal)-Number(t.details.totals.discount),tax=Number(t.details.totals.tax);
 const target=t.items.filter(i=>i.price.id===price),credit=t.items.filter(i=>i.price.id===oldPrice);
 const period=target[0]?.proration?.billing_period;
 const start=new Date(period?.starts_at||''),end=new Date(period?.ends_at||'');
 if(t.status!=='completed' || !Number.isSafeInteger(amount) || amount<=0 || amount>Number(change.amountMinor) ||
   !Number.isSafeInteger(principal) || principal<=0 || principal+tax!==amount || !Number.isSafeInteger(tax) || tax<0 ||
   Number(t.details.totals.discount)!==0 || t.discount_id || !Number.isFinite(+start) ||
   Math.abs(+start-+new Date(change.effectiveAt))>5*60000 || +end!==+new Date(change.periodEnd) ||
   t.items.length!==2 || target.length!==1 || credit.length!==1 || target[0].quantity!==1 || credit[0].quantity!==-1 ||
   !Number.isFinite(Number(target[0].proration?.rate)) || Number(target[0].proration?.rate)<=0 || Number(target[0].proration?.rate)>1 ||
   !Number.isFinite(+new Date(credit[0].proration?.billing_period?.starts_at||'')) ||
   Math.abs(+new Date(credit[0].proration?.billing_period?.starts_at||'')-+start)>60000 ||
   +new Date(credit[0].proration?.billing_period?.ends_at||'')!==+end ||
   +new Date(t.billing_period?.starts_at||'')!==+new Date(change.periodStart) ||
   +new Date(t.billing_period?.ends_at||'')!==+end ||
   t.items.some(i=>i.price.unit_price.currency_code!==currency || i.price.tax_mode!=='internal' ||
     i.price.billing_cycle?.interval!=='month' || i.price.billing_cycle.frequency!==paddlePlan(change.toCode).billingMonths ||
     Number(i.price.unit_price.amount)!==paddleAmount(i.price.id===price?change.toCode:change.fromCode,currency)))
   throw Error('Upgrade payment mismatch');
 const grants=upgradeAllowances(change.fromCode,change.toCode,new Date(change.periodStart),new Date(change.periodEnd),start);
 if(!grants.length) throw Error('No upgrade allowance');
 await tx`insert into shorts_mvp.paddle_payments(transaction_id,user_id,paddle_subscription_id,currency,amount_minor,principal_minor,period_start,period_end,plan_code)
   values(${t.id},${mapped.userId},${mapped.paddleId},${currency},${amount},${principal},${start},${end},${change.toCode})`;
 for(const g of grants) {
   const [grant]=await tx`insert into shorts_mvp.usage_grants(user_id,subscription_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,valid_from,expires_at)
     values(${mapped.userId},${mapped.subscriptionId},'addon',${change.toCode},${g.seconds},${g.seconds},0,${g.start},${g.end}) returning id`;
   await tx`insert into shorts_mvp.paddle_payment_grants(transaction_id,grant_id,original_seconds) values(${t.id},${grant.id},${g.seconds})`;
 }
 // Do not reset consumed minutes or a full month's allowance on a mid-month upgrade.
 await tx`update shorts_mvp.user_subscriptions set plan_code=${change.toCode},updated_at=now()
   where id=${mapped.subscriptionId} and current_period_end=${change.periodEnd}`;
 await tx`update shorts_mvp.paddle_plan_changes set status='applied',transaction_id=${t.id},updated_at=now() where id=${change.id}`;
 return true;
}

export async function paidPlanCode(tx:Db,t:PaddleTransaction,mapped:{paddleId:string},current:string) {
 // Historical duplicate events continue to use the plan that was actually purchased.
 const [paid]=await tx`select plan_code from shorts_mvp.paddle_payments where transaction_id=${t.id}`;
 if(paid?.planCode) return {code:paid.planCode,changeId:null};
 const [pending]=await tx`select * from shorts_mvp.paddle_plan_changes where paddle_subscription_id=${mapped.paddleId}
   and timing='renewal' and status in ('processing','unknown','scheduled') order by created_at desc limit 1 for update`;
 if(pending && +new Date(t.billing_period?.starts_at||'')>=+new Date(pending.effectiveAt)) {
   // A cancellation may have reached Paddle before a process crash. Honor only the
   // canonical paid item; the caller still validates totals, dates and ownership.
   if(pending.cancelRequestedAt && t.items.length===1 && t.currency_code===pending.currency &&
      t.items[0].price.id===paddlePriceId(pending.fromCode,pending.currency)) {
     await tx`update shorts_mvp.paddle_plan_changes set status='superseded',canceled_at=now(),updated_at=now() where id=${pending.id}`;
     return {code:pending.fromCode,changeId:null};
   }
   if(t.items.length!==1 || t.items[0].price.id!==paddlePriceId(pending.toCode,pending.currency) || t.currency_code!==pending.currency)
     throw Error('Scheduled renewal mismatch');
   return {code:pending.toCode,changeId:pending.id};
 }
 return {code:current,changeId:null};
}
