import {it,expect} from 'vitest';
import {paddleDisplayPlans,paddleAmount,paddleInitialTerm,isNewCheckoutPlan,newPaddlePlanCode,currentPaddlePlans,paddleDiscount} from './catalog';
it('restores the pre-increase USD and JPY offers',()=>{
 expect(paddleDisplayPlans(3,'USD').map(p=>p.usd)).toEqual([399,4497,10797]);
 expect(paddleDisplayPlans(6,'USD').map(p=>p.usd)).toEqual([399,7194,20994]);
 expect(paddleDisplayPlans(12,'USD').map(p=>p.usd)).toEqual([399,11988,31188]);
 expect(paddleDisplayPlans(3,'JPY').map(p=>p.jpy)).toEqual([750,6870,16470]);
 expect(paddleDisplayPlans(6,'JPY').map(p=>p.jpy)).toEqual([750,11340,29940]);
 expect(paddleDisplayPlans(12,'JPY').map(p=>p.jpy)).toEqual([750,17880,47880]);
 for(const currency of ['USD','JPY'] as const) for(const months of [3,6,12] as const) for(const p of paddleDisplayPlans(months,currency)) {
  expect(isNewCheckoutPlan(p.code,currency)).toBe(true);
  expect(newPaddlePlanCode(p.code.replace('_jpy_20261021',''),currency)).toBe(p.code);
 }
});
it('rejects increased prices for fresh purchases while preserving settlement and management',()=>{
 for(const p of currentPaddlePlans)for(const currency of ['USD','JPY'] as const)expect(isNewCheckoutPlan(p.code,currency)).toBe(false);
 expect(paddleAmount('paddle_lite_v20261105','USD')).toBe(1200);
 expect(paddleDisplayPlans(6,'JPY','paddle_lite_v20261105').map(p=>p.jpy)).toEqual([1900,17940,52900]);
 expect(paddleDisplayPlans(6,'JPY','paddle_lite').map(p=>p.jpy)).toEqual([590,10740,29940]);
 expect(paddleInitialTerm()).toBe(6);
 expect(paddleDiscount('paddle_creator_6m','USD')?.percent).toBe(20);
});
