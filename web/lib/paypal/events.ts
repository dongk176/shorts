import "server-only";
import { getDb } from "@/lib/db";
import { paypalRequest, paypalEnvironment } from "./api";
import { usdMinor } from "./catalog";
import { syncPayPalSubscription } from "./service";
export type PayPalEvent = { id:string;event_type:string;resource:{id?:string;billing_agreement_id?:string;sale_id?:string} };
export async function processPayPalEvent(event:PayPalEvent,db=getDb()) {
  if(!/^[A-Z0-9-]{8,100}$/.test(event.id) || !event.event_type || !event.resource)throw Error("Invalid event");
  const [done]=await db`select event_id from shorts_mvp.paypal_webhook_events where event_id=${event.id}`;
  if(done)return;
  const kind=event.event_type;
  if(kind.startsWith("BILLING.SUBSCRIPTION.")) {
    await syncPayPalSubscription(event.resource.id??"",db);
  } else if(kind==="PAYMENT.SALE.COMPLETED") {
    const id=event.resource.billing_agreement_id;
    if(!id)throw Error("Missing subscription reference");
    await syncPayPalSubscription(id,db);
  } else if(kind==="PAYMENT.SALE.REFUNDED" || kind==="PAYMENT.SALE.REVERSED") {
    const refundId=kind==="PAYMENT.SALE.REFUNDED"?event.resource.id:null;
    const saleId=kind==="PAYMENT.SALE.REFUNDED"?event.resource.sale_id:event.resource.id;
    if(!saleId || !/^[A-Z0-9]{10,32}$/.test(saleId))throw Error("Missing sale reference");
    const sale=await paypalRequest<{id:string;state:string;billing_agreement_id?:string;amount:{currency:string;total:string}}>(`/v1/payments/sale/${saleId}`);
    let [payment]=await db`select p.*,s.environment from shorts_mvp.paypal_payments p join shorts_mvp.paypal_subscriptions s on s.paypal_id=p.paypal_subscription_id where transaction_id=${saleId}`;
    if(!payment && sale.billing_agreement_id){await syncPayPalSubscription(sale.billing_agreement_id,db);[payment]=await db`select p.*,s.environment from shorts_mvp.paypal_payments p join shorts_mvp.paypal_subscriptions s on s.paypal_id=p.paypal_subscription_id where transaction_id=${saleId}`;}
    if(!payment || payment.environment!==paypalEnvironment() || sale.id!==saleId || sale.amount.currency!=="USD" || usdMinor(sale.amount.total)!==Number(payment.amountMinor))throw Error("Refund payment mismatch");
    let refunded=Number(payment.amountMinor);
    let refund:{id:string;sale_id:string;state:string;amount:{currency:string;total:string}}|null=null;
    if(refundId){
      if(!/^[A-Z0-9]{10,32}$/.test(refundId))throw Error("Invalid refund ID");
      refund=await paypalRequest(`/v1/payments/refund/${refundId}`);
      if(!refund || refund.id!==refundId || refund.sale_id!==saleId || refund.state!=="completed" || refund.amount.currency!=="USD")throw Error("Unconfirmed refund");
      refunded=usdMinor(refund.amount.total);
    }else if(sale.state!=="reversed")throw Error("Unconfirmed reversal");
    await db.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtextextended(${payment.userId},0))`;
      if(refund)await tx`insert into shorts_mvp.paypal_refunds(refund_id,transaction_id,amount_minor) values(${refund.id},${saleId},${refunded}) on conflict do nothing`;
      const [sum]=await tx`select coalesce(sum(amount_minor),0) as total from shorts_mvp.paypal_refunds where transaction_id=${saleId}`;
      const total=refund?Math.min(Number(payment.amountMinor),Number(sum.total)):Number(payment.amountMinor);
      await tx`update shorts_mvp.paypal_payments set refunded_minor=greatest(refunded_minor,${total}) where transaction_id=${saleId}`;
      const grants=await tx`select g.*,pg.original_seconds from shorts_mvp.paypal_payment_grants pg join shorts_mvp.usage_grants g on g.id=pg.grant_id where pg.transaction_id=${saleId} for update of g`;
      for(const g of grants){
        const entitlement=Math.floor(Number(g.originalSeconds)*(1-total/Number(payment.amountMinor)));
        const seconds=Math.max(1,entitlement,Number(g.reservedSeconds)+Number(g.consumedSeconds));
        await tx`update shorts_mvp.usage_grants set total_seconds=${seconds},credited_seconds=${seconds},carried_seconds=0,status=${entitlement===0?"revoked":new Date(g.expiresAt)<=new Date()?"expired":"active"},updated_at=now() where id=${g.id}`;
      }
    });
  } else if(!["PAYMENT.SALE.DENIED","BILLING.SUBSCRIPTION.PAYMENT.FAILED"].includes(kind))return;
  // Record only after successful reconciliation. Retrying a failed delivery remains safe.
  await db`insert into shorts_mvp.paypal_webhook_events(event_id,event_type) values(${event.id},${kind}) on conflict do nothing`;
}
