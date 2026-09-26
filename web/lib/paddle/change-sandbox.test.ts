// Opt-in, isolated local fixture and sandbox only. No production environment is loaded.
import { it,expect } from 'vitest';
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { processPaddleEvent } from './service';
import { paddleRequest } from './api';
import { getDb } from '@/lib/db';
import type { PaddleTransaction,PaddleSubscription } from './models';
it.skipIf(process.env.RUN_PADDLE_CHANGE_SANDBOX!=='sync')('syncs canonical sandbox payments for the isolated change fixture',async()=>{
 const base='/Users/gimdongmin/shorts-clean/.tmp/paddle-integration-20260926';
 const credentials=JSON.parse(fs.readFileSync(base+'/.tmp/paddle-fullapp/secrets.json','utf8'));
 const env=parseEnv(fs.readFileSync(base+'/.secrets/paddle-sandbox.env','utf8')) as Record<string,string>;
 if(env.PADDLE_ENVIRONMENT!=='sandbox'||!env.PADDLE_API_KEY?.startsWith('pdl_sdbx_'))throw Error('Sandbox only');
 Object.assign(process.env,env,{DATABASE_URL:`postgres://postgres:${credentials.dbPassword}@127.0.0.1:55449/paddle_fullapp_local`,PADDLE_ENABLED:'true'});
 delete process.env.VERCEL_ENV;
 const db=getDb();expect((await db`select current_database() as name`)[0].name).toBe('paddle_fullapp_local');
 const user='26ba56f1-dd17-4ddc-b2a2-4cff1a33b0c7';
 const [checkout]=await db`select * from shorts_mvp.paddle_checkouts where user_id=${user} and environment='sandbox' order by created_at desc limit 1`;
 if(!checkout?.transactionId)throw Error('Fixture checkout missing');
 const t=await paddleRequest<PaddleTransaction>(`/transactions/${checkout.transactionId}`);
 expect(t.status).toBe('completed');expect(t.custom_data?.easycut_checkout_id).toBe(checkout.id);
 await processPaddleEvent({event_id:'evt_'+crypto.randomUUID().replaceAll('-','').slice(0,26),event_type:'transaction.completed',occurred_at:new Date().toISOString(),data:{id:t.id}},db);
 const [sub]=await db`select * from shorts_mvp.paddle_subscriptions where user_id=${user} and environment='sandbox' order by created_at desc limit 1`;
 const changes=await db`select * from shorts_mvp.paddle_plan_changes where user_id=${user} order by created_at desc`;
 // The sandbox-only transaction list is read directly, without broadening the production API wrapper.
 const response=await fetch(`https://sandbox-api.paddle.com/transactions?subscription_id=${sub.paddleId}&per_page=30`,{headers:{Authorization:`Bearer ${env.PADDLE_API_KEY}`}});
 if(!response.ok)throw Error('Sandbox transaction lookup failed');
 const transactions=(await response.json()).data as PaddleTransaction[];
 for(const item of transactions.filter(t=>t.origin==='subscription_update'&&t.status==='completed'&&changes.some(c=>c.id===t.custom_data?.easycut_change_id))) {
  await processPaddleEvent({event_id:'evt_'+crypto.randomUUID().replaceAll('-','').slice(0,26),event_type:'transaction.completed',occurred_at:new Date().toISOString(),data:{id:item.id}},db);
 }
 const [state]=await db`select plan_code,current_period_start,current_period_end from shorts_mvp.user_subscriptions where id=${sub.subscriptionId}`;
 const grants=await db`select kind,total_seconds,status,valid_from,expires_at from shorts_mvp.usage_grants where subscription_id=${sub.subscriptionId} order by valid_from`;
 process.stdout.write(JSON.stringify({sandbox:true,state,grants,changes:changes.map(c=>({id:c.id,status:c.status,timing:c.timing,from:c.fromCode,to:c.toCode})),subscriptionId:sub.paddleId})+'\n');
 const canonical=await paddleRequest<PaddleSubscription>(`/subscriptions/${sub.paddleId}`);
 const latest=await db`select status,timing,to_code from shorts_mvp.paddle_plan_changes where user_id=${user} and status<>'quoted' order by created_at desc`;
 expect(+new Date(canonical.next_billed_at!)).toBe(+new Date(state.currentPeriodEnd));
 process.stdout.write(JSON.stringify({providerNext:canonical.next_billed_at,providerPrice:canonical.items[0].price.id,latest})+'\n');

 if(process.env.PADDLE_CHANGE_CLEANUP==='1') {
  expect(canonical.customer_id).toBe(t.customer_id);
  const canceled=await paddleRequest<PaddleSubscription>(`/subscriptions/${sub.paddleId}/cancel`,{effective_from:'immediately'});
  expect(canceled.status).toBe('canceled');
  await processPaddleEvent({event_id:'evt_'+crypto.randomUUID().replaceAll('-','').slice(0,26),event_type:'subscription.canceled',occurred_at:new Date().toISOString(),data:{id:sub.paddleId}},db);
  process.stdout.write('Sandbox fixture canceled; no live subscription modified.\n');
 }
 await db.end();
},60000);
