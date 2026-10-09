import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import type { PopularVideoResponse } from "@/lib/youtube-popular";
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
async function setup(access=true, locale="ko", { deferInitial=false, searchEnabled=true, storage=new Map<string,string>(), storageUnavailable=false, accountKey, initialResponse }: {
  deferInitial?:boolean; searchEnabled?:boolean; storage?:Map<string,string>; storageUnavailable?:boolean; accountKey?:string; initialResponse?: PopularVideoResponse;
} = {}) {
  language.locale=locale;
  const {window,document}=parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window",window);vi.stubGlobal("document",document);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  (window.HTMLElement.prototype as HTMLDialogElement).showModal = function () { this.setAttribute("open", ""); };
  (window.HTMLElement.prototype as HTMLDialogElement).close = function () { this.removeAttribute("open"); };
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key:string) => { if (storageUnavailable) throw new Error("blocked"); return key.includes("reusable-license") ? "1" : storage.get(key) ?? null; },
    setItem: (key:string,value:string) => { if (storageUnavailable) throw new Error("blocked"); storage.set(key,value); },
  } });
  const requests: {url:URL;signal:AbortSignal;resolve:(response:Response)=>void}[]=[];
  vi.stubGlobal("fetch",vi.fn((url:string, options:RequestInit) => {
    const parsedUrl = new URL(url, "http://localhost");
    // Saved state is a separate request; the queue below controls search only.
    if (parsedUrl.pathname === "/api/saved-videos") return Promise.resolve(Response.json({ items: [] }));
    return new Promise<Response>(resolve => requests.push({ url: parsedUrl, signal: options.signal!, resolve }));
  }));
  const container=document.getElementById("app")!;
  root=createRoot(container as unknown as Element);
  await act(async()=>{root!.render(<PopularVideosExplorer initialResponse={initialResponse} searchEnabled={searchEnabled} canUseFilters={access} isAuthenticated={access} accountKey={accountKey} onRequireLogin={()=>{}}/>);});
  const respond=async(index:number,body:Record<string,unknown>={},status=200)=>act(async()=>requests[index].resolve(Response.json({items:[],updatedAt:new Date().toISOString(),searchEnabled:true,japaneseEnabled:true,...body},{status})));
  if (!deferInitial && !initialResponse) await respond(0);
  const input=()=>container.querySelector("#popular-search")!;
  const type=async(value:string)=>act(async()=>props(input()).onChange({target:{value}}));
  const submit=async()=>act(async()=>props(container.querySelector('form[role="search"]')).onSubmit({preventDefault(){}}));
  const button = (text: string) => Array.from(container.querySelectorAll("button")).find(button => button.textContent === text || button.getAttribute("aria-label") === text)!;
  const click = async (element: Element) => act(async () => props(element).onClick());
  const select = async (id:string,label:string,mobile=false) => {
    await click(container.querySelector(`#${id}${mobile ? "-mobile" : ""}`)!);
    const scope=container.querySelector(`#${id}${mobile ? "-sheet" : "-options"}`)!;
    await click(Array.from(scope.querySelectorAll('[role="option"]')).find(option=>option.textContent===label)!);
  };
  return {container,requests,respond,input,type,submit,button,click,select,storage};
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
  it("changes desktop category while preserving search and language, and synchronizes the filter dialog", async () => {
    const page = await setup();
    await page.select("popular-language", "영어"); await page.respond(1);
    await page.type("football"); await page.submit(); await page.respond(2);
    await page.select("popular-category", "스포츠");
    expect(Object.fromEntries(page.requests[3].url.searchParams)).toMatchObject({q: "football", category: "sports", english: "true"});
    expect(page.requests[3].url.searchParams.has("cursor")).toBe(false);
    await page.respond(3);
    await page.click(page.button("필터"));
    expect(page.container.querySelector("#popular-draft-category-mobile")?.textContent).toContain("스포츠");
    await page.select("popular-draft-category", "음악", true);
    await page.click(page.button("적용"));
    expect(page.container.querySelector("#popular-category")?.textContent).toContain("음악");
    expect(page.requests[4].url.searchParams.get("category")).toBe("music");
  });
  it("requires filter access for the desktop category selector", async () => {
    const page = await setup(false);
    await page.select("popular-category", "스포츠");
    expect(page.container.querySelector('[data-testid="existing-plan-guide"]')).not.toBeNull();
    expect(page.requests).toHaveLength(1);
    expect(page.container.querySelector("#popular-category")?.textContent).toContain("전체");
  });

  it("applies category, language, period and length together; cancel discards drafts", async () => {
    const page = await setup();
    await page.click(page.button("필터"));
    expect(page.container.querySelector("select")).toBeNull();
    await page.select("popular-draft-category", "스포츠", true);
    await page.select("popular-draft-language", "한국어", true);
    await page.select("popular-draft-period", "최근 7일", true);
    await page.click(page.container.querySelector('dialog [role="switch"]')!);
    expect(page.requests).toHaveLength(1);
    await page.click(page.button("적용"));
    const params = page.requests[1].url.searchParams;
    expect(Object.fromEntries(params)).toMatchObject({category: "sports", korean: "true", japanese: "false", longForm: "true", period: "week"});
    expect(page.container.querySelector("dialog")).toBeNull();
    await page.respond(1);
    expect(page.container.querySelector('[aria-label="최근 7일 · 조건 해제"]')).not.toBeNull();
    await page.click(page.button("필터"));
    await page.select("popular-draft-category", "음악", true);
    await page.click(page.container.querySelector('[aria-label="필터 닫기"]')!);
    expect(page.requests).toHaveLength(2);
    await page.click(page.button("필터"));
    expect(page.container.querySelector("#popular-draft-category-mobile")?.textContent).toContain("스포츠");
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
    await page.select("popular-draft-category", "스포츠", true);
    await page.select("popular-draft-language", "한국어", true); await page.click(page.button("적용")); await page.respond(2);
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

describe("language dropdown and custom mobile sheets", () => {
  it.each([["ko","korean","언어"],["en","english","Language"],["ja","japanese","言語"]])("uses the %s page language on first entry", async (locale, parameter, label) => {
    const page=await setup(true,locale);
    expect(page.requests).toHaveLength(1);
    expect(page.requests[0].url.searchParams.get(parameter)).toBe("true");
    expect(page.container.querySelector("#popular-language")?.textContent).toContain(label);
    expect(Array.from(page.container.querySelectorAll('fieldset button[role="switch"]')).map(button=>button.textContent)).toHaveLength(2);
  });
  it("changes language exclusively and preserves it through search and pagination", async () => {
    const page=await setup();
    await page.select("popular-language", "영어");
    expect(Object.fromEntries(page.requests[1].url.searchParams)).toMatchObject({english:"true",korean:"false",japanese:"false"});
    await page.respond(1);
    await page.type("football"); await page.submit();
    const video={videoId:"fixture0001",title:"Football",channelName:"Test",viewCount:100,category:"sports",license:"youtube",durationSeconds:300,publishedAt:new Date().toISOString(),thumbnailUrl:"/test.jpg"};
    await page.respond(2,{items:[video],nextCursor:"english-next"});
    await page.click(page.button("더 보기"));
    expect(Object.fromEntries(page.requests[3].url.searchParams)).toMatchObject({english:"true",q:"football",cursor:"english-next"});
    await page.respond(3);
    await page.select("popular-language", "일본어");
    expect(Object.fromEntries(page.requests[4].url.searchParams)).toMatchObject({english:"false",korean:"false",japanese:"true"});
  });
  it.each(["영어", "전체 언어"])("remembers %s across visits and page languages", async selection => {
    const storage=new Map<string,string>();
    const page=await setup(true,"ko",{storage,accountKey:"account-a"});
    await page.select("popular-language",selection);
    await act(async()=>root!.unmount()); root=undefined;
    const restored=await setup(true,"ja",{storage,accountKey:"account-a"});
    expect(restored.requests).toHaveLength(1);
    expect(Object.fromEntries(restored.requests[0].url.searchParams)).toMatchObject({english:String(selection==="영어"),korean:"false",japanese:"false"});
  });
  it("does not reuse another account's preference and works when browser storage is blocked",async()=>{
    const storage=new Map([["easycut:popular-language:v1:account-a","en"]]);
    const page=await setup(true,"ja",{storage,accountKey:"account-b",storageUnavailable:true});
    expect(page.requests[0].url.searchParams.get("japanese")).toBe("true");
    await page.select("popular-language","韓国語");
    expect(page.requests[1].url.searchParams.get("korean")).toBe("true");
  });
  it("applies the mobile language only on Apply, and cancels a custom choice without affecting its parent", async () => {
    const page=await setup();
    await page.click(page.button("필터"));
    await page.select("popular-draft-language","영어",true);
    expect(page.requests).toHaveLength(1);
    expect(page.storage.size).toBe(0);
    await page.click(page.container.querySelector("#popular-draft-period-mobile")!);
    expect(page.container.querySelectorAll("dialog")).toHaveLength(2);
    const preventDefault=vi.fn();
    await act(async()=>props(page.container.querySelector("#popular-draft-period-sheet")).onCancel({preventDefault,stopPropagation:vi.fn()}));
    expect(preventDefault).toHaveBeenCalled();
    expect(page.container.querySelectorAll("dialog")).toHaveLength(1);
    expect(document.body.style.overflow).toBe("hidden");
    await page.click(page.button("적용"));
    expect(page.requests[1].url.searchParams.get("english")).toBe("true");
    expect(page.storage.get("easycut:popular-language:v1:anonymous")).toBe("en");
    await page.respond(1);
    await page.click(page.container.querySelector('[aria-label="영어만 · 조건 해제"]')!);
    expect(page.requests[2].url.searchParams.get("english")).toBe("false");
    expect(page.storage.get("easycut:popular-language:v1:anonymous")).toBe("all");
  });
  it("discards an uncommitted language selection when the filter sheet is dismissed",async()=>{
    const page=await setup(); await page.click(page.button("필터"));
    await page.select("popular-draft-language","영어",true);
    await page.click(page.container.querySelector('[aria-label="필터 닫기"]')!);
    expect(page.requests).toHaveLength(1); expect(page.storage.size).toBe(0);
    await page.click(page.button("필터"));
    expect(page.container.querySelector("#popular-draft-language-mobile")?.textContent).toContain("한국어");
  });
  it("keeps restricted visitors on the public list and shows the existing entitlement guide", async () => {
    const page=await setup(false,"en",{storage:new Map([["easycut:popular-language:v1:anonymous","en"]])});
    expect(Object.fromEntries(page.requests[0].url.searchParams)).toMatchObject({english:"false",korean:"false",japanese:"false"});
    await page.select("popular-language","English");
    expect(page.requests).toHaveLength(1);
    expect(page.container.querySelector('[data-testid="existing-plan-guide"]')).not.toBeNull();
  });
  it("falls back to all languages if Japanese collection is disabled",async()=>{
    const page=await setup(true,"ja",{deferInitial:true});
    await page.respond(0,{code:"JAPANESE_DISCOVERY_DISABLED"},503);
    expect(page.requests[1].url.searchParams.get("japanese")).toBe("false");
    expect(page.storage.size).toBe(0);
  });
});

const publicSnapshot: PopularVideoResponse = {
  items: [{ videoId: "abcdefghijk", title: "Public example title", channelName: "Example channel", thumbnailUrl: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", category: "entertainment", durationSeconds: 300, viewCount: 1234, publishedAt: "2026-09-30T00:00:00Z", license: "youtube" }],
  updatedAt: "2026-10-01T00:00:00Z", nextCursor: "public-cursor",
};
describe("public popular snapshot", () => {
  it("renders video titles in server HTML without fetching or granting paid filters", () => {
    language.locale = "en";
    const html = renderToString(<PopularVideosExplorer initialResponse={publicSnapshot} canUseFilters={false} isAuthenticated={false} searchEnabled={false} onRequireLogin={() => {}} />);
    expect(html).toContain("Public example title");
    expect(html).toContain("Example channel");
    expect(html).not.toContain('aria-busy="true"');
  });
  it("keeps the initial public list through hydration and gates paid interactions", async () => {
    const page = await setup(false, "en", { initialResponse: publicSnapshot });
    expect(page.container.textContent).toContain("Public example title");
    expect(page.requests).toHaveLength(0);
    await page.type("soccer");
    await page.submit();
    expect(page.requests).toHaveLength(0);
  });
  it("does not reuse the public snapshot for an entitled user's language filter", async () => {
    const page = await setup(true, "ja", { initialResponse: publicSnapshot, deferInitial: true });
    expect(page.requests[0].url.searchParams.get("japanese")).toBe("true");
    await page.respond(0);
  });
});
