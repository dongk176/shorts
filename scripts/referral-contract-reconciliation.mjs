import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from '../web/node_modules/postgres/src/index.js';
import { requireProductionDatabaseUrl } from './production-database-identity.mjs';
import { referralAnonymizer } from './referral-reconciliation-anonymizer.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const save=(path,value)=>fs.writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const modes=new Set(['snapshot','preview','apply']);
const [mode,snapshotFile,reportFile] = process.argv.slice(2);
if (!modes.has(mode) || !snapshotFile) throw new Error('Usage: snapshot|preview|apply snapshot.json [report.json]');
const implementationHash=hash(['supabase/migrations/202609130003_referral_contract_caps.sql','scripts/referral-contract-reconciliation.mjs','scripts/referral-reconciliation-anonymizer.mjs','web/lib/referral-policy.ts','web/lib/referral-settlement.ts','web/lib/referral-settlement-server.ts','web/lib/referral-payout-service.ts'].map(p=>fs.readFileSync(root+p,'utf8')));
const preview=mode==='preview';
const connection=preview ? process.env.REFERRAL_PREVIEW_DATABASE_URL : requireProductionDatabaseUrl();
if (preview) {
  const url=new URL(connection);
  if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname!=='/referral_preview') throw new Error('Preview requires isolated localhost/referral_preview');
}
const sql=postgres(connection,{max:1,prepare:false,connect_timeout:10,onnotice:()=>{},
  connection:{application_name:`referral-contract-${mode}`,statement_timeout:20000,lock_timeout:3000,
    ...(mode==='snapshot'?{default_transaction_read_only:'on'}:{})}});

async function collect(tx) {
  const data={};
  data.plans=await tx`select code,prepaid_months from shorts_mvp.plans order by code`;
  data.orders=await tx`select o.id,o.user_id,o.amount_krw,o.refunded_amount_krw,o.status,o.approved_at,o.product_code,
    o.billing_cycle,o.provider,o.kind,o.subscription_id,o.order_id from shorts_mvp.billing_orders o
    where exists(select 1 from shorts_mvp.referral_commissions c where c.billing_order_id=o.id)
    order by o.id`;
  // Include later orders in the same subscription to delimit conversion ownership.
  data.otherOrders=await tx`select o.id,o.user_id,o.amount_krw,o.refunded_amount_krw,o.status,o.approved_at,o.product_code,
    o.billing_cycle,o.provider,o.kind,o.subscription_id,o.order_id from shorts_mvp.billing_orders o
    where o.subscription_id in(select b.subscription_id from shorts_mvp.billing_orders b join shorts_mvp.referral_commissions c on c.billing_order_id=b.id)
      and not exists(select 1 from shorts_mvp.referral_commissions c where c.billing_order_id=o.id) order by o.id`;
  data.commissions=await tx`select id,billing_order_id,partner_id,user_id,commission_rate_bps,gross_amount_krw,
    refunded_amount_krw,commission_amount_krw,available_at,recognition_months,created_at
    from shorts_mvp.referral_commissions order by id`;
  data.installments=await tx`select id,commission_id,installment_number,installment_count,gross_amount_krw,recognized_amount_krw,
    scheduled_commission_amount_krw,commission_amount_krw,earned_at,available_at from shorts_mvp.referral_commission_installments order by id`;
  data.intents=await tx`select id,subscription_id,target_plan_code,purpose,status,created_at from shorts_mvp.billing_toss_checkout_intents
    where subscription_id in(select b.subscription_id from shorts_mvp.billing_orders b join shorts_mvp.referral_commissions c on c.billing_order_id=b.id)
    and purpose='subscription_start' order by id`;
  const keys=['orderId','publicOrderId','previousPlanCode','targetPlanCode','targetContractMonths','newPlanCode','newPeriodEnd','entitlementEndAt',
    'expectedPartialRefundKrw','plannedRefundKrw','refundAmountKrw','retainedAmountKrw','financialConfirmed','paymentStatus'];
  data.audits=await tx`select a.id,a.entity_id,a.action,a.created_at,
    coalesce((select jsonb_object_agg(key,value) from jsonb_each(a.metadata) where key=any(${keys}::text[])),'{}'::jsonb) as metadata
    from shorts_mvp.admin_audit_logs a where a.action in ('subscription.plan_manually_converted','subscription.support_plan_conversion',
      'subscription.support_refund_service_change','billing.external_refund_reconciled')
    and exists(select 1 from shorts_mvp.billing_orders o join shorts_mvp.referral_commissions c on c.billing_order_id=o.id
      where a.entity_id::text in(o.id::text,o.subscription_id::text)
        or a.metadata->>'orderId' in(o.id::text,o.order_id) or a.metadata->>'publicOrderId'=o.order_id)
    order by a.id`;
  data.payouts=await tx`select id,partner_id,amount_krw,status,period_start,period_end from shorts_mvp.referral_payouts order by id`;
  return JSON.parse(JSON.stringify(data));
}
async function result(tx,before) {
  const contracts=await tx`select id,billing_order_id,partner_id,recognition_months,eligible_installment_count,
    original_contract,recognition_status,recognition_reason,recognition_evidence,commission_basis_krw,excluded_sales_krw,
    gross_amount_krw,refunded_amount_krw,commission_amount_krw from shorts_mvp.referral_commissions order by id`;
  const months=await tx`select c.partner_id,to_char(i.earned_at at time zone 'Asia/Seoul','YYYY-MM') as month,
    sum(i.recognized_amount_krw)::integer as basis,sum(i.commission_amount_krw)::integer as commission
    from shorts_mvp.referral_commission_installments i join shorts_mvp.referral_commissions c on c.id=i.commission_id group by 1,2 order by 1,2`;
  const integrity=await tx`select count(*)::integer as orders,
    count(*) filter(where i.basis<>c.commission_basis_krw or i.commission<>c.commission_amount_krw)::integer as broken_totals,
    count(*) filter(where c.recognition_status='review_required')::integer as held
    from shorts_mvp.referral_commissions c join lateral(select sum(recognized_amount_krw) as basis,
      sum(commission_amount_krw) as commission from shorts_mvp.referral_commission_installments where commission_id=c.id)i on true`;
  if (integrity[0].broken_totals) throw new Error('Reconciliation totals failed');
  const previous=new Map(before.commissions.map(c=>[c.id,c]));
  const beforeMonths=new Map();
  for(const i of before.installments) {
    const partner=previous.get(i.commission_id)?.partner_id;
    const month=new Date(new Date(i.earned_at).getTime()+9*3600000).toISOString().slice(0,7);
    const key=partner+':'+month;
    const value=beforeMonths.get(key)??{partner_id:partner,month,basis:0,commission:0};
    value.basis+=i.recognized_amount_krw;value.commission+=i.commission_amount_krw;beforeMonths.set(key,value);
  }
  return {contracts:contracts.map(c=>({...c,previous_commission_krw:previous.get(c.id)?.commission_amount_krw??0})),
    months,beforeMonths:[...beforeMonths.values()],integrity:integrity[0],beforeOrderCount:before.commissions.length};
}
try {
  if(mode==='snapshot') {
    const data=await sql.begin('isolation level repeatable read read only',collect);
    const anonymous=referralAnonymizer(data)(data);
    save(snapshotFile,{version:1,capturedAt:new Date().toISOString(),sourceHash:hash(data),anonymousHash:hash(anonymous),data:anonymous});
    console.log(JSON.stringify({mode,orders:data.commissions.length,payouts:data.payouts.length,snapshotFile}));
  } else if(mode==='preview') {
    if(!reportFile) throw new Error('Report path required');
    const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));const d=snapshot.data;
    if(hash(d)!==snapshot.anonymousHash) throw new Error('Snapshot changed');
    await sql.unsafe(fs.readFileSync(root+'test-fixtures/referral-contract-schema.sql','utf8'));
    await sql`delete from shorts_mvp.plans`;
    if(d.plans.length) await sql`insert into shorts_mvp.plans ${sql(d.plans)}`;
    for(const name of ['202607280002_referral_partner_revenue.sql','202608190001_referral_monthly_commissions.sql','202609100002_referral_calendar_payouts.sql'])
      await sql.unsafe(fs.readFileSync(root+'supabase/migrations/'+name,'utf8'));
    await sql.begin(async tx=>{
      await tx`alter table shorts_mvp.billing_orders disable trigger user`;
      const users=[...new Set([...d.orders,...d.otherOrders].map(o=>o.user_id).filter(Boolean))];
      for(const id of users) await tx`insert into shorts_mvp.app_users(id,email) values(${id},${`user-${id}@example.invalid`})`;
      const partners=[...new Set(d.commissions.map(c=>c.partner_id))];
      for(const id of partners) await tx`insert into shorts_mvp.referral_partners(id,create_request_id,creator_name,slug)
        values(${id},${id},'Anonymous partner',${`p-${id.replaceAll('-','').slice(0,28)}`})`;
      for(const [table,rows] of [['billing_orders',[...d.orders,...d.otherOrders]],['referral_commissions',d.commissions],
        ['referral_commission_installments',d.installments],['billing_toss_checkout_intents',d.intents],['admin_audit_logs',d.audits]]) {
        if(rows.length) await tx`insert into ${tx('shorts_mvp.'+table)} ${tx(rows)}`;
      }
      await tx`alter table shorts_mvp.billing_orders enable trigger user`;
    });
    if(d.payouts.some(p=>['draft','paid'].includes(p.status))) throw new Error('Existing cash requires reconciliation');
    await sql.unsafe(fs.readFileSync(root+'supabase/migrations/202609130003_referral_contract_caps.sql','utf8'));
    const report=await sql.begin(async tx=>{
      const [changed]=await tx`select shorts_mvp.reconcile_referral_contracts() as count`;
      const [again]=await tx`select shorts_mvp.reconcile_referral_contracts() as count`;
      if(again.count!==0) throw new Error('Reconciliation is not idempotent');
      return {sourceHash:snapshot.sourceHash,implementationHash,changed:changed.count,...await result(tx,d)};
    });
    save(reportFile,report);console.log(JSON.stringify({mode,changed:report.changed,...report.integrity,reportFile}));
  } else {
    if(!reportFile) throw new Error('Approved preview report required');
    const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));
    const previewReport=JSON.parse(fs.readFileSync(reportFile,'utf8'));
    if(previewReport.implementationHash!==implementationHash) throw new Error('Implementation changed: rerun preview');
    if(previewReport.sourceHash!==snapshot.sourceHash || previewReport.integrity.broken_totals!==0) throw new Error('Preview mismatch');
    const applied=await sql.begin(async tx=>{
      await tx`lock table shorts_mvp.billing_orders,shorts_mvp.admin_audit_logs,shorts_mvp.referral_commissions,shorts_mvp.referral_payouts in share row exclusive mode`;
      const before=await collect(tx);
      if(hash(before)!==snapshot.sourceHash) throw new Error('Production changed: take a new snapshot and preview');
      await tx`select shorts_mvp.reconcile_referral_contracts()`;
      const after=await result(tx,before);
      const anon=referralAnonymizer(before)(JSON.parse(JSON.stringify(after)));
      anon.contracts.sort((a,b)=>a.id.localeCompare(b.id));
      anon.months.sort((a,b)=>a.partner_id.localeCompare(b.partner_id)||a.month.localeCompare(b.month));
      if(hash(anon.contracts)!==hash(previewReport.contracts)||hash(anon.months)!==hash(previewReport.months)) throw new Error('Production differs from tested preview');
      return {appliedAt:new Date().toISOString(),sourceHash:snapshot.sourceHash,...anon};
    });
    save(reportFile+'.applied.json',applied);console.log(JSON.stringify({mode,...applied.integrity}));
  }
} catch(error) { console.error(JSON.stringify({error:error.message,code:error.code}));process.exitCode=1; }
finally {await sql.end({timeout:3});}
