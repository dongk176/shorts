import { describe, expect, it } from "vitest";
import { rankingCropSize } from "./ranking-crop";
import { defaultRankingFraming, normalizeRankingFraming, rankingFramingGeometry, rankingFramingSchema } from "./ranking-framing";
import { rankingRenderSchema } from "./ranking-shorts";
import { defaultRankingDraft, parseRankingDraft } from "./ranking-draft";

describe("ranking source framing", () => {
  it.each([[720,1280],[1920,1080],[1080,1080],[0,0]])("keeps the current centered crop when unchanged: %s × %s", (w,h) => {
    const original = rankingCropSize(w,h);
    const geometry = rankingFramingGeometry(w,h);
    expect(geometry.window.width).toBe(original.width);
    expect(geometry.window.height).toBe(original.height);
    expect(parseFloat(geometry.media.height)).toBe(100);
  });
  it("keeps the visible source rectangle inside the source at every pan and zoom", () => {
    for (const top of [0,.2,.55]) for (const bottom of [0,.15]) for (const zoom of [1,1.5,2.5]) for (const panY of [-1,0,1]) {
      const g = rankingFramingGeometry(720,1280,{top,bottom,zoom,panY});
      expect(g.viewport.top).toBeGreaterThanOrEqual(-1e-10);
      expect(g.viewport.top + g.viewport.height).toBeLessThanOrEqual(1 + 1e-10);
      expect(g.viewport.left).toBeGreaterThanOrEqual(0);
      expect(g.viewport.left + g.viewport.width).toBeLessThanOrEqual(1);
    }
  });
  it("masks cuts without automatically scaling, cropping to fill, or moving the video", () => {
    const original = rankingFramingGeometry(720,1280);
    const cut = rankingFramingGeometry(720,1280,{top:.2,bottom:.1,zoom:1,panY:0});
    expect(cut.window).toEqual(original.window);
    expect(cut.viewport).toEqual(original.viewport);
    expect(cut.media).toEqual({top:"0%",height:"100%",clipPath:"inset(20% 0 10% 0)"});
    const zoomed = rankingFramingGeometry(720,1280,{top:.2,bottom:.1,zoom:1.5,panY:0});
    expect(parseFloat(zoomed.window.width)).toBeCloseTo(parseFloat(original.window.width)*1.5);
  });
  it("clamps invalid drag ranges and never allows an empty crop", () => {
    const normalized = normalizeRankingFraming({top:99,bottom:99,zoom:Infinity,panY:-99});
    expect(normalized).toMatchObject({top:.6,zoom:1,panY:-1});
    expect(normalized.bottom).toBeCloseTo(.2);
    expect(rankingFramingSchema.safeParse({top:.6,bottom:.6,zoom:1,panY:0}).success).toBe(false);
  });
  it("persists per-rank framing while continuing to read older drafts", () => {
    const draft = defaultRankingDraft();
    expect(parseRankingDraft(draft)).not.toBeNull();
    draft.slots[0].framing = {...defaultRankingFraming,top:.2};
    expect(parseRankingDraft(draft)?.slots[0].framing?.top).toBe(.2);
    expect(parseRankingDraft(draft)?.slots[1].framing).toBeUndefined();
  });
});

it("keeps framing through render validation and rejects unsafe values", () => {
  const framing = {top:.22,bottom:.2,zoom:1.2,panY:-.5};
  const spec = {title:"테스트",descending:false,clips:[{rank:1,sourceId:"193a3540-3366-4526-94be-030a34293344",label:"장면",start:1,end:3,framing}]};
  expect(rankingRenderSchema.parse(spec).clips[0].framing).toEqual(framing);
  for (const invalid of [{...framing,zoom:5},{...framing,top:.6,bottom:.6},{...framing,panY:Infinity},{...framing,extra:"ignored"}])
    expect(rankingRenderSchema.safeParse({...spec,clips:[{...spec.clips[0],framing:invalid}]}).success).toBe(false);
});
