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
