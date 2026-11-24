import {expect,it} from "vitest";
import {rankingSourceEnd} from "./ranking-source-range";
it("reconciles the reported football selection without shifting its start",()=>{
 expect(rankingSourceEnd(6.583,17.915,17.741)).toBe(17.741);
 expect(rankingSourceEnd(7.38,14.51260733695652,19.121)).toBe(14.51260733695652);
});
it("preserves materially invalid or too-short ranges for validation",()=>{
 expect(rankingSourceEnd(1,10,9)).toBe(10);
 expect(rankingSourceEnd(9.4,10,9.8)).toBe(10);
 expect(rankingSourceEnd(0,10,NaN)).toBe(10);
});
it.each([[0,8,7.488],[3.378,14,13.482],[0,8,7.253],[9.5,48,47.232]])("accepts an exact rounded media end (%s,%s,%s)",(start,end,duration)=>{
 expect(rankingSourceEnd(start,end,duration)).toBe(duration);
});
it("does not generalize whole-second rounding to other invalid ranges",()=>{
 expect(rankingSourceEnd(0,8.1,7.253)).toBe(8.1);
 expect(rankingSourceEnd(0,9,7.488)).toBe(9);
 expect(rankingSourceEnd(7.1,8,7.488)).toBe(8);
});
