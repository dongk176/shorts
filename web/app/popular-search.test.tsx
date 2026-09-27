import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { PopularVideosExplorer } from "./실시간인기/popular-videos-explorer";

const language = vi.hoisted(() => ({ locale: "ko" }));
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => language }));
vi.mock("@/lib/i18n/use-ui-text", () => ({ useUiText: () => (value: string) => value }));
vi.mock("@/components/popular-filters-plan-overlay", () => ({ PopularFiltersPlanOverlay: ({open}: {open:boolean}) => open ? <div data-testid="existing-plan-guide"/> : null }));
vi.mock("next/image", () => ({ default: () => null }));
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root=undefined;vi.unstubAllGlobals(); });

// Invoke the mounted React handlers: linkedom does not implement native IME/input tracking.
function props(element: Element | null) {
  const key=Object.keys(element!).find(key=>key.startsWith("__reactProps$"))!;
  return (element as unknown as Record<string, Record<string, (...args: unknown[])=>void>>)[key];
}
async function setup(access=true, locale="ko", { deferInitial=false, searchEnabled=true } = {}) {
  language.locale=locale;
  const {window,document}=parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window",window);vi.stubGlobal("document",document);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  (window.HTMLElement.prototype as HTMLDialogElement).showModal = function () { this.setAttribute("open", ""); };
  (window.HTMLElement.prototype as HTMLDialogElement).close = function () { this.removeAttribute("open"); };
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: () => "1" } });
  const requests: {url:URL;signal:AbortSignal;resolve:(response:Response)=>void}[]=[];
  vi.stubGlobal("fetch",vi.fn((url:string, options:RequestInit) => {
    const parsedUrl = new URL(url, "http://localhost");
    // Saved state is a separate request; the queue below controls search only.
    if (parsedUrl.pathname === "/api/saved-videos") return Promise.resolve(Response.json({ items: [] }));
    return new Promise<Response>(resolve => requests.push({ url: parsedUrl, signal: options.signal!, resolve }));
  }));
  const container=document.getElementById("app")!;
  root=createRoot(container as unknown as Element);
  await act(async()=>{root!.render(<PopularVideosExplorer searchEnabled={searchEnabled} canUseFilters={access} isAuthenticated={access} onRequireLogin={()=>{}}/>);});
  const respond=async(index:number,body:Record<string,unknown>={},status=200)=>act(async()=>requests[index].resolve(Response.json({items:[],updatedAt:new Date().toISOString(),searchEnabled:true,...body},{status})));
  if (!deferInitial) await respond(0);
  const input=()=>container.querySelector("#popular-search")!;
  const type=async(value:string)=>act(async()=>props(input()).onChange({target:{value}}));
  const submit=async()=>act(async()=>props(container.querySelector('form[role="search"]')).onSubmit({preventDefault(){}}));
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find(button => button.textContent === text)!;
  const click = async (element: Element) => act(async () => props(element).onClick());
  return {container,requests,respond,input,type,submit,button,click};
}
describe("stable popular loading UI", () => {
  it("shows search before the first response and preserves text through a failed load", async () => {
    const page = await setup(true, "ko", { deferInitial: true });
    const input = page.input();
    expect(input).not.toBeNull();
    await page.type("축구");
    await page.respond(0, { detail: "일시적 오류" }, 503);
    expect(page.input()).toBe(input);
    expect((page.input() as HTMLInputElement).value).toBe("축구");
    expect(page.container.textContent).not.toContain("개수 확인 중");
    await page.submit();
    expect(page.requests[1].url.searchParams.get("q")).toBe("축구");
    await page.respond(1);
    expect(page.input()).toBe(input);
  });
  it("honors the server search gate independently of the video response", async () => {
    const page = await setup(true, "ko", { deferInitial: true, searchEnabled: false });
    expect(page.input()).toBeNull();
    await page.respond(0);
    expect(page.input()).toBeNull();
  });
  it("keeps the clear button slot and last update time stable during another request", async () => {
    const page = await setup();
    const clear = page.container.querySelector('[aria-label="검색 지우기"]')!;
    const updatedAt = page.container.querySelector("header p")!.textContent;
    expect(clear.hasAttribute("disabled")).toBe(true);
    await page.type("축구");
    expect(page.container.querySelector('[aria-label="검색 지우기"]')).toBe(clear);
    expect(clear.hasAttribute("disabled")).toBe(false);
    await page.submit();
    expect(page.container.querySelector("header p")!.textContent).toBe(updatedAt);
    expect(page.input()).not.toBeNull();
  });
});

describe("simple popular search UI",()=>{
  it("submits explicitly, validates length, hides ranking and clears back to the previous list",async()=>{
    const page=await setup();
    await page.type("손");await page.submit();
    expect(page.requests).toHaveLength(1);
    expect(page.container.querySelector('[role="alert"]')?.textContent).toContain("2~100");
    await page.type("손흥밍");expect(page.requests).toHaveLength(1);
    await page.submit();
    expect(page.requests[1].url.searchParams.get("q")).toBe("손흥밍");
    await page.respond(1,{includesSimilarResults:true});
    expect(page.container.textContent).toContain("검색 결과가 없습니다");
    expect(page.container.querySelector('button[aria-pressed="true"]')).toBeNull();
    await act(async()=>props(page.container.querySelector('[aria-label="검색 지우기"]')).onClick());
    expect(page.requests[2].url.searchParams.has("q")).toBe(false);
    expect(page.requests[2].url.searchParams.get("type")).toBe("trending");
  });
  it("does not search on composition Enter and reuses the entitlement guide",async()=>{
    const page=await setup(false);await page.type("축구");
    await act(async()=>props(page.input()).onCompositionStart());
    const preventDefault=vi.fn();
    await act(async()=>props(page.input()).onKeyDown({key:"Enter",nativeEvent:{isComposing:true},preventDefault}));
    await page.submit();expect(preventDefault).toHaveBeenCalled();expect(page.requests).toHaveLength(1);
    await act(async()=>props(page.input()).onCompositionEnd());await page.submit();
    expect(page.container.querySelector('[data-testid="existing-plan-guide"]')).not.toBeNull();
    expect(page.requests).toHaveLength(1);
  });
  it("ignores an old response after a newer search and shows errors as retryable failures",async()=>{
    const page=await setup();await page.type("축구");await page.submit();await page.type("요리");await page.submit();
    expect(page.requests[1].signal.aborted).toBe(true);
    await page.respond(2,{detail:"일시적 오류"},503);
    await page.respond(1);
    expect(page.container.textContent).toContain("검색 결과를 불러오지 못했습니다");
    expect(page.container.textContent).not.toContain("검색 결과가 없습니다");
    await page.type("");await page.submit();
    expect(page.requests.at(-1)!.url.searchParams.has("q")).toBe(false);
  });
  it("cancels load more when a new search changes the result set",async()=>{
    const page=await setup();await page.type("축구");await page.submit();
    const video={videoId:"fixture0001",title:"축구 영상",channelName:"테스트",viewCount:100,category:"sports",license:"youtube",durationSeconds:300,publishedAt:new Date().toISOString(),thumbnailUrl:"/test.jpg"};
    await page.respond(1,{items:[video],nextCursor:"previous-page"});
    const more=Array.from(page.container.querySelectorAll("button")).find(button=>button.textContent==="더 보기")!;
    await act(async()=>props(more).onClick());
    expect(page.requests[2].url.searchParams.get("cursor")).toBe("previous-page");
    await page.type("요리");await page.submit();
    expect(page.requests[2].signal.aborted).toBe(true);
    expect(page.requests[3].url.searchParams.has("cursor")).toBe(false);
    await page.respond(3,{items:[{...video,videoId:"fixture0002",title:"요리 영상"}]});
    await page.respond(2,{items:[{...video,videoId:"fixture0003",title:"오래된 다음 페이지"}]});
    expect(page.container.textContent).toContain("요리 영상");
    expect(page.container.textContent).not.toContain("오래된 다음 페이지");
  });
  it.each([["en","Search titles or channels"],["ja","タイトル・チャンネル検索"]])("localizes the search field in %s",async(locale,placeholder)=>{
    const page=await setup(true,locale);expect(page.input().getAttribute("placeholder")).toBe(placeholder);
  });
});


describe("compact popular filters", () => {
  it("applies category, language, period and length together; cancel discards drafts", async () => {
    const page = await setup();
    await page.click(page.button("필터"));
    const selects = page.container.querySelectorAll("dialog select");
    await act(async () => props(selects[0]).onChange({target: {value: "sports"}}));
    await page.click(page.button("한국어"));
    await act(async () => props(selects[1]).onChange({target: {value: "week"}}));
    await page.click(page.container.querySelector('dialog [role="switch"]')!);
    expect(page.requests).toHaveLength(1);
    await page.click(page.button("적용"));
    const params = page.requests[1].url.searchParams;
    expect(Object.fromEntries(params)).toMatchObject({category: "sports", korean: "true", japanese: "false", longForm: "true", period: "week"});
    expect(page.container.querySelector("dialog")).toBeNull();
    await page.respond(1);
    expect(page.container.querySelector('[aria-label="최근 7일 · 조건 해제"]')).not.toBeNull();
    await page.click(page.container.querySelector('[aria-haspopup="dialog"][aria-expanded]')!);
    await act(async () => props(page.container.querySelector("dialog select")).onChange({target: {value: "music"}}));
    await page.click(page.container.querySelector('[aria-label="필터 닫기"]')!);
    expect(page.requests).toHaveLength(2);
    await page.click(page.container.querySelector('[aria-haspopup="dialog"][aria-expanded]')!);
    expect((page.container.querySelector("dialog select") as HTMLSelectElement).value).toBe("sports");
    await page.click(page.button("초기화"));
    expect(page.requests).toHaveLength(2);
    await page.click(page.button("적용"));
    expect(Object.fromEntries(page.requests[2].url.searchParams)).toMatchObject({category: "all", korean: "false", longForm: "false", period: "all"});
  });
  it("keeps reuse enabled when changing ranking, searching, clearing, and resetting detailed filters", async () => {
    const page = await setup();
    const reuse = () => page.container.querySelector('[aria-label="재사용 허용 영상만 보기"]')!;
    await page.click(reuse());
    expect(page.requests[1].url.searchParams.get("reusable")).toBe("true");
    await page.respond(1);
    await page.click(page.button("조회수 상위"));
    expect(Object.fromEntries(page.requests[2].url.searchParams)).toMatchObject({type: "views", reusable: "true"});
    await page.respond(2);
    await page.type("축구"); await page.submit();
    expect(Object.fromEntries(page.requests[3].url.searchParams)).toMatchObject({q: "축구", reusable: "true"});
    await page.respond(3);
    await page.click(page.container.querySelector('[aria-label="검색 지우기"]')!);
    expect(Object.fromEntries(page.requests[4].url.searchParams)).toMatchObject({type: "views", reusable: "true"});
    await page.respond(4);
    await page.click(page.button("필터")); await page.click(page.button("초기화")); await page.click(page.button("적용"));
    expect(page.requests[5].url.searchParams.get("reusable")).toBe("true");
    await page.respond(5);
    await page.click(reuse());
    expect(page.requests[6].url.searchParams.get("reusable")).toBe("false");
  });
  it("removes one applied condition without losing the others or the search", async () => {
    const page = await setup();
    await page.type("축구"); await page.submit(); await page.respond(1);
    await page.click(page.button("필터"));
    await act(async () => props(page.container.querySelector("dialog select")).onChange({target: {value: "sports"}}));
    await page.click(page.button("한국어")); await page.click(page.button("적용")); await page.respond(2);
    await page.click(page.container.querySelector('[aria-label="스포츠 · 조건 해제"]')!);
    expect(Object.fromEntries(page.requests[3].url.searchParams)).toMatchObject({q: "축구", category: "all", korean: "true"});
    expect(page.requests[3].url.searchParams.has("cursor")).toBe(false);
  });
  it("uses the existing access guide for filters and reuse without requesting data", async () => {
    const page = await setup(false);
    await page.click(page.button("필터"));
    expect(page.container.querySelector("dialog")).toBeNull();
    expect(page.container.querySelector('[data-testid="existing-plan-guide"]')).not.toBeNull();
    await page.click(page.container.querySelector('[aria-label="재사용 허용 영상만 보기"]')!);
    expect(page.requests).toHaveLength(1);
  });
});
