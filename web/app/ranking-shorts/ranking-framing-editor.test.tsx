import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultRankingFraming } from "@/lib/ranking-framing";
import type { RankingFraming } from "@/lib/ranking-framing";
import { analyzeRankingBackground } from "@/lib/ranking-auto-framing";
import { RankingFramingEditor } from "./ranking-framing-editor";
vi.mock("@/lib/ranking-auto-framing", () => ({analyzeRankingBackground:vi.fn()}));

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  vi.mocked(analyzeRankingBackground).mockReset();
  const {window,document} = parseHTML('<html><body><div id="app"></div></body></html>');
  vi.stubGlobal("window",window); vi.stubGlobal("document",document); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  container = document.getElementById("app")!; root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
function Harness({url, initial = defaultRankingFraming, start = 0}: {url?:string;initial?:RankingFraming;start?:number}) {
  const [value,setValue] = useState(initial);
  return <><RankingFramingEditor width={720} height={1280} value={value} onChange={setValue} playing={false} ready time={3} onToggle={() => {}} analysisUrl={url} start={start} end={8}><div>source</div></RankingFramingEditor><output id="value">{JSON.stringify(value)}</output></>;
}
async function click(text: string) { await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === text)!.click()); }
async function cutTop() {
  await act(async () => {
    const event = new window.Event("keydown", {bubbles:true});
    Object.defineProperty(event,"key",{value:"ArrowDown"});
    container.querySelector('[aria-label="위쪽 자르기"]')!.dispatchEvent(event);
  });
}
it("keeps adjustments collapsed, applies live changes, and restores on cancel", async () => {
  await act(async () => root.render(<Harness />));
  expect(container.querySelector('[aria-label="위쪽 자르기"]')).toBeNull();
  await click("화면 조정"); await cutTop();
  expect(container.querySelector('#value')!.textContent).toContain('"top":0.01');
  await click("취소");
  expect(container.querySelector('#value')!.textContent).toContain('"top":0');
  expect(container.querySelector('[aria-label="위쪽 자르기"]')).toBeNull();
});

it("auto-finds only cuts, retains explicit zoom/pan, and supports undo",async()=>{
  const initial={top:.1,bottom:.05,zoom:1.3,panY:-.4};
  vi.mocked(analyzeRankingBackground).mockResolvedValue({top:.2,bottom:.15});
  await act(async()=>root.render(<Harness url="blob:source" initial={initial} />));
  await click("영상 영역 자동 찾기");
  expect(analyzeRankingBackground).toHaveBeenCalledWith("blob:source",0,8,expect.any(AbortSignal));
  expect(container.querySelector('#value')!.textContent).toBe(JSON.stringify({...initial,top:.2,bottom:.15}));
  expect(container.querySelector('[aria-label="위쪽 자르기"]')).not.toBeNull();
  await click("되돌리기");
  expect(container.querySelector('#value')!.textContent).toBe(JSON.stringify(initial));
});
it("keeps existing cuts on uncertain detection and allows a retry after failure",async()=>{
  const initial={top:.12,bottom:.08,zoom:1,panY:0};
  vi.mocked(analyzeRankingBackground).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("다시 시도해 주세요."));
  await act(async()=>root.render(<Harness url="blob:source" initial={initial} />));
  await click("영상 영역 자동 찾기");
  expect(container.textContent).toContain("뚜렷한 상하 배경을 찾지 못했어요");
  expect(container.querySelector('#value')!.textContent).toBe(JSON.stringify(initial));
  await click("영상 영역 자동 찾기");
  expect(container.textContent).toContain("다시 시도해 주세요.");
  expect(Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='영상 영역 자동 찾기')!.disabled).toBe(false);
});
it("aborts on cancel/range changes and ignores late analysis responses",async()=>{
  let complete!: (value:{top:number;bottom:number})=>void;
  vi.mocked(analyzeRankingBackground).mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  await act(async()=>root.render(<Harness url="blob:source" />));
  await click("영상 영역 자동 찾기");
  const first=vi.mocked(analyzeRankingBackground).mock.calls[0][3];
  await click("취소");expect(first.aborted).toBe(true);
  await act(async()=>complete({top:.2,bottom:.2}));
  expect(container.querySelector('#value')!.textContent).toBe(JSON.stringify(defaultRankingFraming));
  await click("영상 영역 자동 찾기");
  const second=vi.mocked(analyzeRankingBackground).mock.calls[1][3];
  await act(async()=>root.render(<Harness url="blob:source" start={2} />));
  expect(second.aborted).toBe(true);
  await act(async()=>complete({top:.2,bottom:.2}));
  expect(container.querySelector('#value')!.textContent).toBe(JSON.stringify(defaultRankingFraming));
  expect(container.textContent).not.toContain("분석 중");
});
it("does not overwrite manual edits made while analysis is running",async()=>{
  let complete!: (value:{top:number;bottom:number})=>void;
  vi.mocked(analyzeRankingBackground).mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  await act(async()=>root.render(<Harness url="blob:source" />));
  await click("영상 영역 자동 찾기");await cutTop();
  await act(async()=>complete({top:.2,bottom:.2}));
  expect(container.querySelector('#value')!.textContent).toContain('"top":0.01');
  expect(container.textContent).toContain("화면 조정이 바뀌었어요");
});
it("leaves the official YouTube embed without an analysis/download request",async()=>{
  await act(async()=>root.render(<Harness />));
  const button=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='영상 영역 자동 찾기')!;
  expect(button.disabled).toBe(true);expect(analyzeRankingBackground).not.toHaveBeenCalled();
});
it("retains applied cuts when reopened and resets them explicitly", async () => {
  await act(async () => root.render(<Harness />));
  await click("화면 조정"); await cutTop(); await click("완료"); await click("화면 조정");
  expect(container.querySelector('[aria-label="위쪽 자르기"]')!.getAttribute('aria-valuenow')).toBe("1");
  await click("초기화");
  expect(container.querySelector('#value')!.textContent).toBe(JSON.stringify(defaultRankingFraming));
});


it("drags a cut handle with pointer capture and cancels with Escape", async () => {
  await act(async () => root.render(<Harness />));
  await click("화면 조정");
  const stage = container.querySelector(".ranking-framing-stage")!;
  stage.getBoundingClientRect = () => ({height:400}) as DOMRect;
  const handle = container.querySelector('[aria-label="위쪽 자르기"]')!;
  Object.defineProperty(handle,"setPointerCapture",{value:vi.fn()});
  async function pointer(type: string,y: number) {
    await act(async () => {
      const event = new window.Event(type,{bubbles:true});
      for (const [key,value] of Object.entries({pointerId:1,button:0,clientY:y})) Object.defineProperty(event,key,{value});
      handle.dispatchEvent(event);
    });
  }
  await pointer("pointerdown",0); await pointer("pointermove",100); await pointer("pointerup",100);
  expect(container.querySelector('#value')!.textContent).toContain('"top":0.25');
  await act(async () => {
    const event = new window.Event("keydown",{bubbles:true}); Object.defineProperty(event,"key",{value:"Escape"}); handle.dispatchEvent(event);
  });
  expect(container.querySelector('#value')!.textContent).toBe(JSON.stringify(defaultRankingFraming));
  expect(container.querySelector('[aria-label="위쪽 자르기"]')).toBeNull();
});
