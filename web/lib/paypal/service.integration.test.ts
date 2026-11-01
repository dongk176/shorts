import { beforeAll,beforeEach,afterAll,it,expect,vi } from 'vitest';
import fs from 'node:fs';
import type { Sql } from 'postgres';
import { PGlite } from '../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js';
vi.mock('server-only',()=>({}));
const planId='P-1234567890123456789012';
vi.mock('./api',()=>({paypalRequest:vi.fn(),paypalEnabled:()=>true,paypalEnvironment:()=> 'sandbox',paypalPlanId:()=> 'P-1234567890123456789012'}));
import { paypalRequest } from './api';
import { preparePayPalCheckout,syncPayPalSubscription,validatePayPalPayment,validatePayPalPlan } from './service';
import { paypalPlan } from './catalog';
import { processPayPalEvent } from './events';
let pg:PGlite;
const user='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',checkout='00000000-0000-4000-8000-000000000003';
const id='I-123456789012';
let sub: Record<string,unknown>,transactions:Record<string,unknown>[],remote:Record<string,unknown>;
function db(engine:Pick<PGlite,'query'>):Sql{
 const tag=async(s:TemplateStringsArray,...values:unknown[])=>{const q=s.reduce((v,p,i)=>v+(i?'$'+i:'')+p,'');const r=await engine.query<Record<string,unknown>>(q,values);return r.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v])));};
 return Object.assign(tag,{begin:(fn:(tx:Sql)=>Promise<unknown>)=>pg.transaction(tx=>fn(db(tx)))}) as unknown as Sql;
}
const payment=(sale='SALE1234567890123',time='2026-11-01T00:00:00Z',amount='87.00')=>({id:sale,status:'COMPLETED',time,amount_with_breakdown:{gross_amount:{currency_code:'USD',value:amount}}});
beforeAll(async()=>{pg=new PGlite();await pg.exec(`create schema shorts_mvp;create role anon;create role authenticated;create role service_role;
create table shorts_mvp.app_users(id uuid primary key,withdrawn_at timestamptz);
create table shorts_mvp.billing_orders(id uuid primary key default gen_random_uuid(),user_id uuid,status text,checkout_expires_at timestamptz);
create table shorts_mvp.billing_toss_checkout_intents(id uuid primary key default gen_random_uuid(),user_id uuid,status text,expires_at timestamptz);
create table shorts_mvp.paddle_checkouts(id uuid primary key,user_id uuid,status text);
create table shorts_mvp.user_subscriptions(id uuid primary key,user_id uuid,plan_code text,status text,billing_cycle text,payment_provider text constraint user_subscriptions_payment_provider_check check(payment_provider in ('toss','paddle','thepayone')),current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean default false,next_charge_at timestamptz,updated_at timestamptz default now());
create table shorts_mvp.usage_grants(id uuid primary key default gen_random_uuid(),user_id uuid,subscription_id uuid,kind text,product_code text,total_seconds int,credited_seconds int,carried_seconds int,reserved_seconds int default 0,consumed_seconds int default 0,valid_from timestamptz,expires_at timestamptz,status text default 'active',updated_at timestamptz default now(),check(reserved_seconds+consumed_seconds<=total_seconds));
create unique index base_once on shorts_mvp.usage_grants(subscription_id,valid_from,kind) where subscription_id is not null and kind='base';`);
const migration=fs.readFileSync('../supabase/migrations/20261101070715_paypal_billing.sql','utf8');await pg.exec(migration);await pg.exec(migration);
},30000);
beforeEach(async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-01T00:10:00Z'));
 await pg.exec(`truncate shorts_mvp.paypal_webhook_events,shorts_mvp.paypal_refunds,shorts_mvp.paypal_payment_grants,shorts_mvp.paypal_payments,shorts_mvp.paypal_subscriptions,shorts_mvp.paypal_checkouts,shorts_mvp.user_subscriptions,shorts_mvp.usage_grants,shorts_mvp.app_users,shorts_mvp.billing_orders,shorts_mvp.billing_toss_checkout_intents,shorts_mvp.paddle_checkouts cascade;
insert into shorts_mvp.app_users(id)values('${user}'),('${other}');
insert into shorts_mvp.paypal_checkouts(id,user_id,environment,plan_code,provider_plan_id,provider_subscription_id,locale,status)values('${checkout}','${user}','sandbox','starter_3m','${planId}','${id}','en','ready');`);
 sub={id,plan_id:planId,custom_id:checkout,status:'ACTIVE',quantity:'1',create_time:'2026-11-01T00:00:00Z',billing_info:{next_billing_time:'2027-02-01T00:00:00Z'}};
 transactions=[payment()];remote={id:planId,product_id:'PROD-2W975416W47409145',status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',frequency:{interval_unit:'MONTH',interval_count:3},total_cycles:0,pricing_scheme:{fixed_price:{currency_code:'USD',value:'87.00'}}}]};
 vi.mocked(paypalRequest).mockReset();vi.mocked(paypalRequest).mockImplementation(async(path)=>{if(path.includes('/transactions?'))return {transactions,total_items:transactions.length};if(path.startsWith('/v1/billing/plans/'))return remote;if(path.startsWith('/v1/payments/sale/'))return {id:'SALE1234567890123',state:'partially_refunded',amount:{currency:'USD',total:'87.00'}};if(path.startsWith('/v1/payments/refund/'))return {id:'REFUND12345678901',sale_id:'SALE1234567890123',state:'completed',amount:{currency:'USD',total:'43.50'}};return sub;});
});
afterAll(async()=>{vi.useRealTimers();await pg.close();});
it('grants three monthly periods only after canonical payment, duplicate deliveries do not add grants',async()=>{
 await syncPayPalSubscription(id,db(pg));await syncPayPalSubscription(id,db(pg));
 expect((await pg.query('select * from shorts_mvp.paypal_payments')).rows).toHaveLength(1);
 const grants=(await pg.query<{total_seconds:number;valid_from:Date}>('select * from shorts_mvp.usage_grants order by valid_from')).rows;
 expect(grants).toHaveLength(3);expect(grants.map(g=>g.total_seconds)).toEqual([12000,12000,12000]);expect(new Date(grants[1].valid_from).toISOString()).toBe('2026-12-01T00:00:00.000Z');
});
it('approval and ACTIVE subscription alone never grant paid access',async()=>{transactions=[];await syncPayPalSubscription(id,db(pg));expect((await pg.query('select * from shorts_mvp.usage_grants')).rows).toHaveLength(0);});
it('rejects wrong amount, currency, plan override and ownership before granting',async()=>{
 transactions=[payment('SALE1234567890123','2026-11-01T00:00:00Z','44.97')];await expect(syncPayPalSubscription(id,db(pg))).rejects.toThrow('payment mismatch');
 transactions=[payment()];sub.plan_overridden=true;await expect(syncPayPalSubscription(id,db(pg))).rejects.toThrow('subscription mismatch');
 sub.plan_overridden=false;sub.plan_id='P-OTHER';await expect(syncPayPalSubscription(id,db(pg))).rejects.toThrow('subscription mismatch');
 expect((await pg.query('select * from shorts_mvp.usage_grants')).rows).toHaveLength(0);
});
it('cancellation stops renewal while paid grants remain available',async()=>{await syncPayPalSubscription(id,db(pg));sub.status='CANCELLED';await syncPayPalSubscription(id,db(pg));const [s]=(await pg.query<{cancel_at_period_end:boolean}>('select * from shorts_mvp.user_subscriptions')).rows;expect(s.cancel_at_period_end).toBe(true);expect((await pg.query("select * from shorts_mvp.usage_grants where status='active'")).rows).toHaveLength(3);});
it('domestic attempts and account withdrawal are blocked while PayPal remains billable',async()=>{await syncPayPalSubscription(id,db(pg));await expect(pg.exec(`insert into shorts_mvp.billing_orders(user_id,status)values('${user}','pending')`)).rejects.toThrow('Resolve PayPal');await expect(pg.exec(`update shorts_mvp.app_users set withdrawn_at=now() where id='${user}'`)).rejects.toThrow('Cancel PayPal');});
it('partial refunds reduce all monthly grants once across duplicate notifications',async()=>{await syncPayPalSubscription(id,db(pg));const event={id:'WH-EVENT123456789',event_type:'PAYMENT.SALE.REFUNDED',resource:{id:'REFUND12345678901',sale_id:'SALE1234567890123'}};await processPayPalEvent(event,db(pg));await processPayPalEvent(event,db(pg));const grants=(await pg.query<{total_seconds:number}>('select * from shorts_mvp.usage_grants')).rows;expect(grants.map(g=>g.total_seconds)).toEqual([6000,6000,6000]);});
it('blocks another provider subscription before checkout creation',async()=>{await pg.exec(`delete from shorts_mvp.paypal_checkouts;insert into shorts_mvp.user_subscriptions(id,user_id,plan_code,status,billing_cycle,payment_provider)values(gen_random_uuid(),'${user}','easycut_pro_v2','active','monthly','toss')`);await expect(preparePayPalCheckout(user,'starter_3m','en',db(pg))).rejects.toThrow('existing subscription');});
it('does not accept a catalog price with the right label but wrong billing frequency',()=>{const r=remote as unknown as Parameters<typeof validatePayPalPlan>[0];r.billing_cycles[0].frequency.interval_count=1;expect(()=>validatePayPalPlan(r,paypalPlan('starter_3m'),planId)).toThrow('catalog mismatch');});
it('does not accept floating or malformed USD amounts',()=>{expect(()=>validatePayPalPayment(payment('SALE1234567890123','2026-11-01T00:00:00Z','87.001'),paypalPlan('starter_3m'))).toThrow('Invalid USD');});
it('annual Expert payment releases twelve separate monthly allowances',async()=>{await pg.exec(`update shorts_mvp.paypal_checkouts set plan_code='expert_12m'`);transactions=[payment('SALE1234567890123','2026-11-01T00:00:00Z','588.00')];await syncPayPalSubscription(id,db(pg));const grants=(await pg.query<{total_seconds:number;valid_from:Date}>('select * from shorts_mvp.usage_grants order by valid_from')).rows;expect(grants).toHaveLength(12);expect(grants.every(g=>g.total_seconds===36000)).toBe(true);expect(new Date(grants[11].valid_from).toISOString()).toBe('2027-10-01T00:00:00.000Z');});
it('renewal settled slightly late stays on the original monthly boundary',async()=>{await syncPayPalSubscription(id,db(pg));vi.setSystemTime(new Date('2027-02-02T01:00:00Z'));transactions.push(payment('SALE2234567890123','2027-02-02T00:00:00Z'));await syncPayPalSubscription(id,db(pg));const rows=(await pg.query<{period_start:Date}>('select * from shorts_mvp.paypal_payments order by period_start')).rows;expect(rows).toHaveLength(2);expect(new Date(rows[1].period_start).toISOString()).toBe('2027-02-01T00:00:00.000Z');});
it('rejects provider subscription ownership mismatch without adding paid access',async()=>{await pg.exec(`update shorts_mvp.paypal_checkouts set provider_subscription_id='I-OTHER1234567'`);await expect(syncPayPalSubscription(id,db(pg))).rejects.toThrow('ownership mismatch');expect((await pg.query('select * from shorts_mvp.usage_grants')).rows).toHaveLength(0);});
it('full reversal revokes every monthly allowance without violating consumed balances',async()=>{await syncPayPalSubscription(id,db(pg));await pg.exec('update shorts_mvp.usage_grants set consumed_seconds=100');vi.mocked(paypalRequest).mockImplementation(async(path)=>{if(path.startsWith('/v1/payments/sale/'))return {id:'SALE1234567890123',state:'reversed',amount:{currency:'USD',total:'87.00'}};return sub;});await processPayPalEvent({id:'WH-REVERSAL123456',event_type:'PAYMENT.SALE.REVERSED',resource:{id:'SALE1234567890123'}},db(pg));const grants=(await pg.query<{status:string;total_seconds:number}>('select * from shorts_mvp.usage_grants')).rows;expect(grants.every(g=>g.status==='revoked'&&g.total_seconds===100)).toBe(true);});

it('rejects a correctly priced plan attached to another product',()=>{const r=remote as unknown as Parameters<typeof validatePayPalPlan>[0];r.product_id='PROD-4M935244FP7175734';expect(()=>validatePayPalPlan(r,paypalPlan('starter_3m'),planId)).toThrow('catalog mismatch');});
