import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { paypalEnvironment,paypalRequest } from "./api";
import { oneTimeReturnOrigin } from "./one-time-config";
import { validateOneTimeOrder, type PayPalOrder } from "./one-time";

export const oneTimeWebhookEvents = ["CHECKOUT.ORDER.APPROVED","PAYMENT.CAPTURE.COMPLETED","PAYMENT.CAPTURE.PENDING","PAYMENT.CAPTURE.DECLINED","PAYMENT.CAPTURE.REFUNDED","PAYMENT.CAPTURE.REVERSED"];
type Hook = {id:string;url:string;event_types:{name:string}[]};
export async function configureOneTimeWebhook() {
  oneTimeReturnOrigin();
  if(paypalEnvironment()!=="live")throw Error('Live configuration required');
  const id=process.env.PAYPAL_WEBHOOK_ID;
  if(!id||! /^[A-Z0-9-]{5,64}$/.test(id))throw Error('Webhook identity unavailable');
  const current=await paypalRequest<Hook>(`/v1/notifications/webhooks/${id}`);
  const url='https://www.easycut.co.kr/api/paypal/webhook';
  if(current.id!==id||current.url!==url)throw Error('Existing webhook destination mismatch');
  const names=new Set(current.event_types.map(event=>event.name));
  const missing=oneTimeWebhookEvents.filter(name=>!names.has(name)&&!names.has('*'));
  if(missing.length)await paypalRequest(`/v1/notifications/webhooks/${id}`,[{op:'replace',path:'/event_types',value:[...names,...missing].map(name=>({name}))}],{method:'PATCH'});
  const verified=await paypalRequest<Hook>(`/v1/notifications/webhooks/${id}`);
  if(verified.url!==url||!oneTimeWebhookEvents.every(name=>verified.event_types.some(event=>event.name===name||event.name==='*')))throw Error('Webhook update unconfirmed');
  return {verified:true,url,events:verified.event_types.map(event=>event.name),changed:missing.length>0};
}

export async function inspectOneTimeLiveConfiguration(createDraft=false) {
  const origin=oneTimeReturnOrigin(),db=getDb();
  const url=new URL(process.env.DATABASE_URL||'invalid:');
  const identity=JSON.stringify({protocol:'postgresql:',username:decodeURIComponent(url.username),hostname:url.hostname.toLowerCase().replace(/\.$/,''),port:url.port||'5432',database:decodeURIComponent(url.pathname.replace(/^\//,''))});
  const fingerprint='sha256:'+createHash('sha256').update(identity).digest('hex');
  if(fingerprint!=='sha256:be47955061a9c7b2204ea3bd2e950c7dae6d31f6a484f1780c6b69630744f20a')throw Error('Production database identity mismatch');
  const [schema]=await db`select to_regclass('shorts_mvp.paypal_one_time_orders') is not null as orders,to_regclass('shorts_mvp.paypal_one_time_grants') is not null as grants,to_regclass('shorts_mvp.paypal_one_time_refunds') is not null as refunds`;
  if(!schema.orders||!schema.grants||!schema.refunds)throw Error('One-time billing schema unavailable');
  const hook=await paypalRequest<Hook>(`/v1/notifications/webhooks/${process.env.PAYPAL_WEBHOOK_ID}`);
  let draft:null|{id:string;status:string;merchantBound:boolean}=null;
  if(createDraft) {
    const id=randomUUID();
    const remote=await paypalRequest<PayPalOrder>('/v2/checkout/orders',{intent:'CAPTURE',purchase_units:[{reference_id:id,custom_id:id,invoice_id:`EC-${id}`,description:'EasyCut integration check; unpaid draft',amount:{currency_code:'USD',value:'12.00'}}]},{requestId:id});
    validateOneTimeOrder(remote,{id,planCode:'pro_1m',providerOrderId:null,merchantId:null});
    if(remote.status!=='CREATED')throw Error('Unexpected unpaid draft status');
    draft={id:remote.id,status:remote.status,merchantBound:true};
  }
  return {checkedAt:new Date().toISOString(),mode:'one_time',environment:paypalEnvironment(),returnOrigin:origin,databaseFingerprint:fingerprint,schema,
    webhookValid:hook.url==='https://www.easycut.co.kr/api/paypal/webhook'&&oneTimeWebhookEvents.every(name=>hook.event_types.some(event=>event.name===name||event.name==='*')),
    webhookEvents:hook.event_types.map(event=>event.name),draft,realCardApproval:'not_tested'};
}
