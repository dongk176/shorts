import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { afterEach, expect, it, vi } from "vitest";
import PopularPicker from "./ranking-popular-picker";
import { VideoCard } from "../실시간인기/popular-videos-explorer";
import type { PopularVideo } from "@/lib/youtube-popular";

vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ locale: "ko" }), useNavigationLocale: () => "ko" }));
vi.mock("next/image", () => ({ default: () => null }));

const video: PopularVideo = {
  videoId: "abcdefghijk", title: "선택할 쇼츠", channelName: "테스트 채널",
  thumbnailUrl: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", category: "entertainment",
  durationSeconds: 25, viewCount: 5000, publishedAt: "2026-10-25T00:00:00Z", license: "youtube",
};
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});
async function mount(element: React.ReactNode) {
  const { window, document } = parseHTML("<html><body><div id='app'></div></body></html>");
  vi.stubGlobal("window", window); vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  (window.HTMLElement.prototype as HTMLDialogElement).showModal = function () { this.setAttribute("open", ""); };
  (window.HTMLElement.prototype as HTMLDialogElement).close = function () { this.removeAttribute("open"); };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [video], updatedAt: "2026-10-25" })));
  const container = document.getElementById("app")!;
  root = createRoot(container);
  await act(async () => root!.render(element));
  return container;
}
async function click(element: Element) {
  await act(async () => element.dispatchEvent(new window.Event("click", { bubbles: true })));
}
function handlers(element:Element) {
  const key=Object.keys(element).find(k=>k.startsWith('__reactProps$'))!;
  return (element as unknown as Record<string,Record<string,(value:unknown)=>void>>)[key];
}

it("opens two actions first and selects only after the explicit Shorts selection", async () => {
  const selected = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? <PopularPicker onClose={() => setOpen(false)} onSelect={item => { selected(item); setOpen(false); }} /> : <p>구간 선택</p>;
  }
  const container = await mount(<Harness />);
  const card = container.querySelector(".popular-video-card")!;
  expect(card.querySelector("a")).toBeNull();
  await click(card.querySelector("button")!);
  expect(selected).not.toHaveBeenCalled();
  const youtube = card.querySelector("a")!;
  expect(youtube.textContent).toContain("유튜브로 보기");
  expect(youtube.getAttribute("href")).toBe("https://www.youtube.com/watch?v=abcdefghijk");
  expect(youtube.getAttribute("target")).toBe("_blank");
  const choose = [...card.querySelectorAll("button")].find(button => button.textContent === "쇼츠 선택")!;
  await click(choose);
  expect(selected).toHaveBeenCalledExactlyOnceWith(video);
  expect(container.querySelector("dialog")).toBeNull();
  expect(container.textContent).toBe("구간 선택");
});

it("keeps ordinary popular-page actions unchanged when no ranking selection is supplied", async () => {
  const container = await mount(<VideoCard video={video} rank={1} active onOpen={() => {}} onClose={() => {}} />);
  expect(container.querySelector("a")?.textContent).toContain("유튜브로");
  expect(container.textContent).not.toContain("쇼츠 선택");
  expect(container.textContent).toContain("링크 복사");
});

it("submits descriptions to the admin-only related search and keeps the chosen video selectable", async()=>{
  const selected=vi.fn();const container=await mount(<PopularPicker onClose={()=>{}} onSelect={selected}/>);
  const fetcher=vi.mocked(fetch);fetcher.mockResolvedValueOnce(Response.json({items:[video],updatedAt:'now',searchMode:'related'}));
  const input=container.querySelector('input')!;
  await act(async()=>handlers(input).onChange({target:{value:'웃긴 동물 반전'}}));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async()=>handlers(container.querySelector('form')!).onSubmit({preventDefault(){}}));
  expect(fetcher).toHaveBeenLastCalledWith('/api/ranking-shorts/discover',expect.objectContaining({method:'POST',body:JSON.stringify({q:'웃긴 동물 반전',category:'all',language:'all',period:'all',reusable:false})}));
  expect(container.textContent).toContain('의미·제목·채널을 함께 검색');
  expect(container.textContent).toContain('관련도순');
  await click(container.querySelector('.popular-video-card button')!);
  await click([...container.querySelectorAll('button')].find(button=>button.textContent==='쇼츠 선택')!);
  expect(selected).toHaveBeenCalledExactlyOnceWith(video);
});

it("describes deterministic fallback without exposing provider details", async()=>{
  const container=await mount(<PopularPicker onClose={()=>{}} onSelect={()=>{}}/>);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({items:[video],updatedAt:'now',searchMode:'keyword'}));
  await act(async()=>handlers(container.querySelector('input')!).onChange({target:{value:'침착맨'}}));
  await act(async()=>handlers(container.querySelector('form')!).onSubmit({preventDefault(){}}));
  expect(container.textContent).toContain('제목·채널 검색 결과');
  expect(container.textContent).not.toContain('임베딩');
});
