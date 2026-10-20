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

it('separates new JPY contracts from legacy renewals and leaves USD unchanged', async () => {
 const {newJpyPaddlePlans,isNewCheckoutPlan}=await import('./catalog');
 expect(paddleDisplayPlans(3,'JPY').map(p=>p.jpy)).toEqual([750,6870,16470]);
 expect(paddleDisplayPlans(6,'JPY').map(p=>p.jpy)).toEqual([750,11340,29940]);
 expect(paddleDisplayPlans(12,'JPY').map(p=>p.jpy)).toEqual([750,17880,47880]);
 expect(paddleDisplayPlans(3,'JPY','paddle_creator_3m').map(p=>p.jpy)).toEqual([590,6570,15270]);
 expect(paddleDisplayPlans(6,'USD').map(p=>p.usd)).toEqual([399,7194,20994]);
 for(const p of newJpyPaddlePlans) {
  expect(isNewCheckoutPlan(p.code,'JPY')).toBe(true);
  expect(isNewCheckoutPlan(p.code,'USD')).toBe(false);
  expect(isNewCheckoutPlan(p.code.replace('_jpy_20261021',''),'JPY')).toBe(false);
 }
 expect(paddleDiscount('paddle_creator_6m_jpy_20261021','JPY')?.percent).toBe(17.4);
 expect(paddleDiscount('paddle_creator_12m_jpy_20261021','JPY')?.percent).toBe(34.9);
 expect(paddleDiscount('paddle_pro_6m_jpy_20261021','JPY')?.percent).toBe(9.1);
 expect(paddleDiscount('paddle_pro_12m_jpy_20261021','JPY')?.percent).toBe(27.3);
});
