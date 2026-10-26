import { expect, it } from "vitest";
import { detectRankingBackground, type RankingAnalysisFrame } from "./ranking-auto-framing";

function frames(top = 48, bottom = 64, background = [0, 0, 0], withText = false): RankingAnalysisFrame[] {
  const width = 192, height = 320;
  return Array.from({length:7}, (_, scene) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
      const bar = y < top || y >= height-bottom;
      const rgb = bar ? background.map(c => Math.max(0, Math.min(255,c + (scene+x+y)%5-2))) : [(x*7+scene*13)%220+20,(y*9+scene*11)%220+20,((x+y)*5+scene*19)%220+20];
      if (bar && withText && ((y>top*.3&&y<top*.3+10)||(y>height-bottom*.6&&y<height-bottom*.6+10)) && x>20&&x<150&&x%16<8) rgb.fill(background[0]<128?240:10);
      data.set([...rgb,255],(y*width+x)*4);
    }
    return {width,height,data};
  });
}
it("finds black top/bottom bars across scenes, including static title/caption pixels",()=>{
  const detected=detectRankingBackground(frames(48,64,[0,0,0],true));
  expect(detected?.top).toBeCloseTo(.15,2);expect(detected?.bottom).toBeCloseTo(.2,2);
});
it("finds compressed white and colored backgrounds without assuming black",()=>{
  for(const background of [[255,255,255],[28,65,105]]) {
    const detected=detectRankingBackground(frames(32,80,background,true));
    expect(detected?.top).toBeCloseTo(.1,2);expect(detected?.bottom).toBeCloseTo(.25,2);
  }
});
it("handles one-sided backgrounds and ignores a blank fade frame",()=>{
  const source=frames(0,64);source[0]={...source[0],data:new Uint8ClampedArray(source[0].data.length)};
  expect(detectRankingBackground(source)).toEqual({top:0,bottom:.2});
});
it("leaves full-bleed, blank, inconsistent, tiny and excessive crops untouched",()=>{
  expect(detectRankingBackground(frames(0,0))).toBeNull();
  const blank=frames().map(frame=>({...frame,data:new Uint8ClampedArray(frame.data.length)}));
  expect(detectRankingBackground(blank)).toBeNull();
  expect(detectRankingBackground(frames().slice(0,3))).toBeNull();
  expect(detectRankingBackground([...frames(48,64).slice(0,3),...frames(0,0).slice(0,4)])).toBeNull();
  expect(detectRankingBackground(frames(2,2))).toBeNull();
  expect(detectRankingBackground(frames(128,128))).toBeNull();
});
