// Opt-in verification of the browser workflow; isolated local DB and Paddle sandbox only.
import {it,expect} from 'vitest';
import fs from 'node:fs';import {parseEnv} from 'node:util';
import {getDb} from '@/lib/db';import {paddleRequest} from './api';import {paddlePriceId} from './config';
import type {PaddleSubscription,PaddleTransaction} from './models';
it.skipIf(process.env.RUN_PADDLE_CANCEL_SANDBOX!=='verify')('verifies cancellation restored the paid plan without an extra payment',async()=>{
 const base='/Users/gimdongmin/shorts-clean/.tmp/paddle-integration-20260926';
 const c=JSON.parse(fs.readFileSync(base+'/.tmp/paddle-fullapp/secrets.json','utf8'));
 const env=parseEnv(fs.readFileSync(base+'/.secrets/paddle-sandbox.env','utf8')) as Record<string,string>;
 if(env.PADDLE_ENVIRONMENT!=='sandbox'||!env.PADDLE_API_KEY?.startsWith('pdl_sdbx_'))throw Error('Sandbox only');
 Object.assign(process.env,env,{DATABASE_URL:`postgres://postgres:${c.dbPassword}@127.0.0.1:55449/paddle_fullapp_local`,PADDLE_ENABLED:'true'});delete process.env.VERCEL_ENV;
 const db=getDb();expect((await db`select current_database() as name`)[0].name).toBe('paddle_fullapp_local');
 try {
  const user='26ba56f1-dd17-4ddc-b2a2-4cff1a33b0c7';
  const [change]=await db`select c.* from shorts_mvp.paddle_plan_changes c join shorts_mvp.paddle_subscriptions ps on ps.paddle_id=c.paddle_subscription_id
   where c.user_id=${user} and ps.environment='sandbox' and c.cancel_requested_at is not null order by c.created_at desc limit 1`;
  expect(change.status).toBe('superseded');expect(change.canceledAt).toBeTruthy();
  const sub=await paddleRequest<PaddleSubscription>(`/subscriptions/${change.paddleSubscriptionId}`);
  expect(sub.status).toBe('active');expect(sub.items[0].price.id).toBe(paddlePriceId(change.fromCode,change.currency));
  expect(+new Date(sub.next_billed_at!)).toBe(+new Date(change.periodEnd));
  const [local]=await db`select s.* from shorts_mvp.user_subscriptions s join shorts_mvp.paddle_subscriptions ps on ps.subscription_id=s.id where ps.paddle_id=${sub.id}`;
  expect(local.planCode).toBe(change.fromCode);expect(+new Date(local.currentPeriodEnd)).toBe(+new Date(change.periodEnd));
  const grants=await db`select total_seconds from shorts_mvp.usage_grants where subscription_id=${local.id}`;
  expect(grants.map(g=>g.totalSeconds)).toEqual([3600]);
  const response=await fetch(`https://sandbox-api.paddle.com/transactions?subscription_id=${sub.id}&per_page=30`,{headers:{Authorization:`Bearer ${env.PADDLE_API_KEY}`},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Sandbox lookup failed');
  const transactions=(await response.json()).data as PaddleTransaction[];
  expect(transactions.filter(t=>t.status==='completed')).toHaveLength(1);expect(transactions.some(t=>t.origin==='subscription_update')).toBe(false);
  console.log(JSON.stringify({sandbox:true,subscription:sub.id,restoredPlan:local.planCode,renewal:sub.next_billed_at,minutes:60,completedPayments:1,changePayments:0,status:change.status}));
 } finally {await db.end();}
},60000);
