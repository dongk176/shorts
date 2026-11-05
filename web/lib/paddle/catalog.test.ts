import {it,expect} from 'vitest';
import {paddleDiscount,paddleInitialTerm,paddleDisplayPlans,paddleAmount} from './catalog';
it('uses the actual 3-month monthly rate, separately for each currency, without overstating savings',()=>{
 for(const months of [6,12] as const) for(const currency of ['USD','JPY'] as const) for(const p of paddleDisplayPlans(months).slice(1)) {
  const d=paddleDiscount(p.code,currency)!;
  const exact=(1-paddleAmount(p.code,currency)/months/(paddleAmount(d.baseline,currency)/3))*100;
  expect(d.percent).toBeLessThanOrEqual(exact);expect(exact-d.percent).toBeLessThan(.101);
 }
 expect(paddleDiscount('paddle_lite','USD')).toBeNull();
 expect(paddleDiscount('paddle_creator_3m','JPY')).toBeNull();
 expect(paddleDiscount('paddle_creator_6m','USD')?.percent).toBe(20);
 expect(paddleDiscount('paddle_creator_6m','JPY')?.percent).toBe(18.2);
});
it('preserves active package duration and defaults new/monthly subscriptions to six months',()=>{
 expect(paddleInitialTerm('paddle_pro_3m')).toBe(3);
 expect(paddleInitialTerm('paddle_creator_12m')).toBe(12);
 expect(paddleInitialTerm('paddle_lite')).toBe(6);
 expect(paddleInitialTerm()).toBe(6);
});

it('separates new USD/JPY contracts from all legacy renewals', async () => {
 const {currentPaddlePlans,isNewCheckoutPlan}=await import('./catalog');
 expect(paddleDisplayPlans(3,'JPY').map(p=>p.jpy)).toEqual([1900,12900,30900]);
 expect(paddleDisplayPlans(6,'JPY').map(p=>p.jpy)).toEqual([1900,17940,52900]);
 expect(paddleDisplayPlans(12,'JPY').map(p=>p.jpy)).toEqual([1900,34900,87900]);
 expect(paddleDisplayPlans(3,'JPY','paddle_creator_3m').map(p=>p.jpy)).toEqual([590,6570,15270]);
 expect(paddleDisplayPlans(6,'USD').map(p=>p.usd)).toEqual([1200,14400,35400]);
 for(const p of currentPaddlePlans) {
  expect(isNewCheckoutPlan(p.code,'JPY')).toBe(true);
  expect(isNewCheckoutPlan(p.code,'USD')).toBe(true);
  expect(isNewCheckoutPlan(p.code.replace('_v20261105',''),'JPY')).toBe(false);
 }
 expect(paddleDiscount('paddle_creator_6m_jpy_20261021','JPY')?.percent).toBe(17.4);
 expect(paddleDiscount('paddle_creator_12m_jpy_20261021','JPY')?.percent).toBe(34.9);
 expect(paddleDiscount('paddle_pro_6m_jpy_20261021','JPY')?.percent).toBe(9.1);
 expect(paddleDiscount('paddle_pro_12m_jpy_20261021','JPY')?.percent).toBe(27.3);
});

it('makes six-month Starter the default with a substantial monthly saving and preserves legacy catalogs',()=>{
 expect(paddleInitialTerm()).toBe(6);
 expect(paddleAmount('paddle_creator_6m_v20261105','JPY')/6).toBe(2990);
 expect(paddleDiscount('paddle_creator_6m_v20261105','JPY')!.percent).toBeGreaterThan(30);
 expect(paddleDisplayPlans(6,'USD','paddle_lite').map(p=>p.usd)).toEqual([399,7194,20994]);
 expect(paddleDisplayPlans(6,'JPY','paddle_lite_jpy_20261021').map(p=>p.jpy)).toEqual([750,11340,29940]);
});
