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
