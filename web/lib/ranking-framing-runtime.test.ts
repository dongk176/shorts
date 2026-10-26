import { expect, it } from "vitest";
import { rankingNeedsFraming, requireRankingFramingCapability } from "./ranking-framing-runtime";
const clip={rank:1,sourceId:"193a3540-3366-4526-94be-030a34293344",label:"scene",start:0,end:1};
it("keeps legacy/default jobs on their existing path and detects explicit adjustments",()=>{
  expect(rankingNeedsFraming()).toBe(false);
  expect(rankingNeedsFraming({clips:[clip]})).toBe(false);
  const base={top:0,bottom:0,zoom:1,panY:0};
  expect(rankingNeedsFraming({clips:[{...clip,framing:base}]})).toBe(false);
  for(const change of [{top:.1},{bottom:.1},{zoom:1.1},{panY:-.2}])
    expect(rankingNeedsFraming({clips:[{...clip,framing:{...base,...change}}]})).toBe(true);
});
it("fails closed against old/unknown runtimes instead of silently losing cuts",()=>{
  for(const health of [null,{ok:true},{ok:true,capabilities:[]},{ok:false,capabilities:["source-framing-v1"]}])
    expect(()=>requireRankingFramingCapability(health)).toThrow("이전 편집 공간");
  expect(()=>requireRankingFramingCapability({ok:true,capabilities:["source-framing-v1"]})).not.toThrow();
});
