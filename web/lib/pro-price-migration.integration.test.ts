import fs from 'node:fs';
import { afterAll,beforeAll,expect,it } from 'vitest';
import { PGlite } from '../../test-tools/node_modules/@electric-sql/pglite/dist/index.js';
let pg:PGlite;
beforeAll(async()=>{
 pg=new PGlite();
 await pg.exec(`create schema shorts_mvp;
 create table shorts_mvp.plans(code text primary key constraint plans_code_check check(code in ('toss_easycut_pro_1m','paddle_lite_jpy_20261021')),display_name text,monthly_source_seconds integer,retention_days integer,sort_order integer,monthly_price_krw integer,yearly_price_krw integer,max_active_jobs integer,is_active boolean,prepaid_months integer);
 create table shorts_mvp.billing_toss_checkout_intents(target_plan_code text constraint billing_toss_checkout_intents_target_plan_code_check check(target_plan_code='toss_easycut_pro_1m'));
 create table shorts_mvp.user_subscriptions(id integer,plan_code text references shorts_mvp.plans(code),billing_price_krw integer);
 insert into shorts_mvp.plans values('toss_easycut_pro_1m','이지컷 프로',3600,30,140,9900,9900,1,false,1),('paddle_lite_jpy_20261021','Legacy overseas',3600,30,141,0,0,1,false,1);
 insert into shorts_mvp.user_subscriptions values(1,'toss_easycut_pro_1m',9900);`);
 const sql=fs.readFileSync('../supabase/migrations/20261101100203_pro_monthly_19900_new_customers.sql','utf8');
 await pg.exec(sql);await pg.exec(sql);
},30000);
afterAll(async()=>{await pg.close();});
it('adds the 19,900 product without changing existing renewal prices',async()=>{
 expect((await pg.query('select plan_code,billing_price_krw from shorts_mvp.user_subscriptions')).rows).toEqual([{plan_code:'toss_easycut_pro_1m',billing_price_krw:9900}]);
 expect((await pg.query('select monthly_price_krw,yearly_price_krw from shorts_mvp.plans where code=$1',['toss_easycut_pro_1m'])).rows).toEqual([{monthly_price_krw:9900,yearly_price_krw:9900}]);
 expect((await pg.query('select monthly_price_krw,yearly_price_krw,monthly_source_seconds,max_active_jobs,prepaid_months,is_active from shorts_mvp.plans where code=$1',['toss_easycut_pro_1m_20261101'])).rows).toEqual([{monthly_price_krw:19900,yearly_price_krw:19900,monthly_source_seconds:3600,max_active_jobs:1,prepaid_months:1,is_active:false}]);
 expect((await pg.query('select count(*)::int as count from shorts_mvp.plans')).rows).toEqual([{count:3}]);
});
it('accepts the new checkout product and retains overseas and arbitrary-product boundaries',async()=>{
 await pg.exec(`insert into shorts_mvp.billing_toss_checkout_intents values('toss_easycut_pro_1m_20261101')`);
 await pg.exec(`update shorts_mvp.plans set display_name='Legacy overseas unchanged' where code='paddle_lite_jpy_20261021'`);
 await expect(pg.exec(`insert into shorts_mvp.plans(code)values('rogue_product')`)).rejects.toThrow('plans_code_check');
 await expect(pg.exec(`insert into shorts_mvp.billing_toss_checkout_intents values('rogue_product')`)).rejects.toThrow('target_plan_code_check');
});
