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
async function setup(access=true, locale="ko") {
  language.locale=locale;
  const {window,document}=parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window",window);vi.stubGlobal("document",document);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const requests: {url:URL;signal:AbortSignal;resolve:(response:Response)=>void}[]=[];
  vi.stubGlobal("fetch",vi.fn((url:string, options:RequestInit)=>new Promise<Response>(resolve=>requests.push({url:new URL(url,"http://localhost"),signal:options.signal!,resolve}))));
  const container=document.getElementById("app")!;
  root=createRoot(container as unknown as Element);
  await act(async()=>{root!.render(<PopularVideosExplorer canUseFilters={access} isAuthenticated={access} onRequireLogin={()=>{}}/>);});
  const respond=async(index:number,body:Record<string,unknown>={},status=200)=>act(async()=>requests[index].resolve(Response.json({items:[],updatedAt:new Date().toISOString(),searchEnabled:true,...body},{status})));
  await respond(0);
  const input=()=>container.querySelector("#popular-search")!;
  const type=async(value:string)=>act(async()=>props(input()).onChange({target:{value}}));
  const submit=async()=>act(async()=>props(container.querySelector('form[role="search"]')).onSubmit({preventDefault(){}}));
  return {container,requests,respond,input,type,submit};
}
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
    expect(page.container.querySelectorAll("fieldset[hidden]").length).toBe(2);
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
  it.each([["en","Search titles or channels"],["ja","タイトルやチャンネル名を検索"]])("localizes the search field in %s",async(locale,placeholder)=>{
    const page=await setup(true,locale);expect(page.input().getAttribute("placeholder")).toBe(placeholder);
  });
});
