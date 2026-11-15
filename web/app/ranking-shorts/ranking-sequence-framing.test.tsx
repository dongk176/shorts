import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { defaultRankingStyle } from "@/lib/ranking-templates";
import { RankingSequencePreview } from "./ranking-sequence-preview";

vi.mock("./ranking-overlay", () => ({RankingOverlay: () => <svg data-overlay /> }));
vi.mock("@/components/ranking-thumbnail", () => ({RankingThumbnail: () => <div data-still /> }));
let root: Root, container: HTMLElement;
let frames: Map<number,FrameRequestCallback>, counter: number;
let play: ReturnType<typeof vi.fn>;
beforeEach(() => {
  const {window,document} = parseHTML('<html><body><div id="app"></div></body></html>');
  vi.stubGlobal("window",window);vi.stubGlobal("document",document);vi.stubGlobal("Element",window.Element);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  frames=new Map();counter=0;
  vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback) => {frames.set(++counter,callback);return counter;});
  vi.stubGlobal("cancelAnimationFrame",(id:number) => frames.delete(id));
  const states = new WeakMap<Element,boolean>();
  play=vi.fn(function(this:HTMLElement) {states.set(this,false);this.dispatchEvent(new window.Event("playing"));return Promise.resolve();});
  Object.defineProperties(window.HTMLElement.prototype,{
    readyState:{configurable:true,get:()=>4}, duration:{configurable:true,get:()=>30},
    paused:{configurable:true,get(){return states.get(this) ?? true;}},
    play:{configurable:true,value:play},
    pause:{configurable:true,value:function(this:HTMLElement){if(states.get(this)===false){states.set(this,true);this.dispatchEvent(new window.Event("pause"));}}},
  });
  container=document.getElementById("app")!;root=createRoot(container);
});
afterEach(async () => {await act(async()=>root.unmount());vi.unstubAllGlobals();});
const props = {
  clips:[{rank:3,sourceId:"a",start:1,end:3},{rank:1,sourceId:"transition",start:0,end:.86,transitionUrl:"/audio/lip-bass.mp4"},{rank:1,sourceId:"b",start:2,end:4}],
  localMedia:{a:"blob:a",b:"blob:b",music:"blob:music"},backgroundMusic:{sourceId:"music",volume:.15},project:null,
  title:"제목",subtitle:"랭킹",count:4,labels:["첫 장면","","셋째"],descending:true,style:defaultRankingStyle,
  previewSource:{id:"a",width:720,height:1280,duration:8,hasAudio:true},previewStart:1,previewRank:3,
  framedSources:{a:{width:720,height:1280,framing:{top:.2,bottom:.1,zoom:1,panY:0}},b:{width:1920,height:1080,framing:{top:.1,bottom:.1,zoom:1.2,panY:.4}}},
  controlsBelow:true,suspended:false,pauseSignal:0,onStart:vi.fn(),
};
const current = () => container.querySelector<HTMLVideoElement>(".ranking-sequence-scene:not(.is-buffered) video")!;
async function mount(extra = {}) {await act(async()=>root.render(<RankingSequencePreview {...props} {...extra} />));}
async function clickPlay(){await act(async()=>container.querySelector<HTMLButtonElement>(".ranking-preview-toggle")!.click());}
async function tick(time:number){
  current().currentTime=time;
  await act(async()=>{const entry=frames.entries().next().value;if(entry){frames.delete(entry[0]);entry[1](0);}});
}
it("plays custom order, full black transitions and local music while keeping per-source framing",async()=>{
  await mount();
  expect(container.querySelector(".ranking-preview-toggle")!.closest(".ranking-composition")).toBeNull();
  expect(current().getAttribute("src")).toBe("blob:a");
  await clickPlay();expect(current().paused).toBe(false);
  expect(container.querySelector<HTMLAudioElement>("audio")!.paused).toBe(false);
  await tick(3);
  expect(current().getAttribute("src")).toBe("/audio/lip-bass.mp4");
  expect(container.querySelector(".ranking-composition.is-transition")).not.toBeNull();
  expect(current().closest(".ranking-framed-region")).toBeNull();
  expect(container.querySelector("[data-overlay]")).toBeNull();
  await tick(.86);
  expect(current().getAttribute("src")).toBe("blob:b");
  expect(current().currentTime).toBe(2);
  expect(current().closest(".ranking-framed-original")!.getAttribute("style")).toContain("inset(10%");
  await tick(4);
  expect(current().paused).toBe(true);
  expect(container.querySelector<HTMLAudioElement>("audio")!.paused).toBe(true);
  expect(container.textContent).toContain("0:04.9 / 0:04.9");
});
it("updates masks without replacing or restarting the playing source",async()=>{
  await mount();await clickPlay();const before=current();const calls=play.mock.calls.length;
  await mount({framedSources:{...props.framedSources,a:{...props.framedSources.a,framing:{top:.3,bottom:.2,zoom:1,panY:0}}}});
  expect(current()).toBe(before);expect(play.mock.calls.length).toBe(calls);
  expect(current().closest(".ranking-framed-original")!.getAttribute("style")).toContain("inset(30%");
});
it("pauses media/music when the completed output or a mobile sheet takes focus",async()=>{
  await mount();await clickPlay();await mount({suspended:true});
  expect(current().paused).toBe(true);expect(container.querySelector<HTMLAudioElement>("audio")!.paused).toBe(true);
  expect(container.querySelector<HTMLButtonElement>(".ranking-preview-toggle")!.disabled).toBe(true);
});

it("keeps buffered media while trimming and resets playback to the edited sequence", async () => {
  await mount({resetKey:"before"});
  const media = Array.from(container.querySelectorAll("video"));
  const audio = container.querySelector("audio");
  await clickPlay();
  await tick(3);
  await tick(.86);
  expect(current().getAttribute("src")).toBe("blob:b");
  const clips = props.clips.map((clip, index) => index === 0 ? {...clip, start:1.5, end:2.5} : clip);
  await mount({clips, resetKey:"after"});
  expect(Array.from(container.querySelectorAll("video"))).toEqual(media);
  expect(container.querySelector("audio")).toBe(audio);
  expect(current()).toBe(media[0]);
  expect(current().currentTime).toBe(1.5);
  expect(current().paused).toBe(true);
  expect(audio!.paused).toBe(true);
  await clickPlay();
  await tick(2.5);
  expect(current().getAttribute("src")).toBe("/audio/lip-bass.mp4");
});

it("retains sources when reordering and starts at the new first clip", async () => {
  await mount({resetKey:"before"});
  const a=current();
  const b=container.querySelector<HTMLVideoElement>('video[src="blob:b"]')!;
  await mount({clips:[props.clips[2],props.clips[0]], resetKey:"reordered"});
  expect(current()).toBe(b);
  expect(current().currentTime).toBe(2);
  expect(container.querySelector('video[src="blob:a"]')).toBe(a);
  await clickPlay();await tick(4);
  expect(current()).toBe(a);
});

it("does not show a playback error when trimming cancels a pending play", async () => {
  await mount({resetKey:"before"});
  let rejectPlay!: (reason: unknown) => void;
  play.mockImplementationOnce(() => new Promise((_resolve, reject) => {rejectPlay=reject;}));
  await clickPlay();
  await mount({resetKey:"trimmed"});
  await act(async () => rejectPlay(new DOMException("interrupted", "AbortError")));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(current().paused).toBe(true);
});
