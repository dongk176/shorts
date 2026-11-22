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

it("matches whole-second player endpoints to their measured container tails", () => {
  expect(rankingSourceEnd(29, 39, 38.464)).toBe(38.464);
  expect(rankingSourceEnd(0, 10, 9.009)).toBe(9.009);
  expect(rankingSourceEnd(0, 31, 30.378)).toBe(30.378);
  expect(rankingSourceEnd(0, 10.1, 9.3)).toBe(10.1);
});
