import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AdminPublishingButton } from "./admin-publishing-button";
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ locale: "en" }) }));
vi.mock("@/lib/i18n/navigation", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("./meta-publishing", () => ({ MetaPublishingPanel: ({platform}:{platform:string}) => <div data-platform={platform}/> }));
vi.mock("./tiktok-publishing", () => ({ TikTokPublishingPanel: () => <div data-platform="tiktok"/> }));
function visibleLabel(element: Element) {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach(icon => icon.remove());
  return copy.textContent;
}
let root: Root | undefined;
afterEach(async () => { if(root) await act(async () => root!.unmount());root=undefined;vi.unstubAllGlobals(); });
async function render(props: Partial<ComponentProps<typeof AdminPublishingButton>> = {}, oauth: false | "youtube" | "tiktok" = false) {
  const {window,document}=parseHTML('<html><body><div id="app"></div></body></html>');
  const location=new URL(`https://www.easycut.co.kr/en/projects/1${oauth?`?${oauth}Account=connected`:''}`);
  Object.defineProperty(window,'location',{configurable:true,value:location});
  Object.defineProperty(window,'history',{configurable:true,value:{replaceState:vi.fn(),state:null}});
  const storage=new Map<string,string>();
  if(oauth){storage.set('easycut-admin-publishing-short','short-a');storage.set('easycut-publish-return-v1',JSON.stringify({shortId:'short-a',path:'/en/projects/1',expires:Date.now()+60000}));}
  vi.stubGlobal('sessionStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  Object.assign(window.HTMLElement.prototype,{showModal(this: HTMLElement){this.setAttribute('open','');},close(this: HTMLElement){this.removeAttribute('open');}});
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const fetcher=vi.fn(async()=>Response.json({connections:[],disconnectStatus:'none',reconnectAfterSeconds:0}));vi.stubGlobal('fetch',fetcher);
  root=createRoot(document.getElementById('app')! as unknown as Element);
  await act(async()=>{root!.render(<AdminPublishingButton shortId="short-a" title="Original clip" {...props}/>);});
  const click=async(selector:string)=>{const element=document.querySelector(selector);expect(element).not.toBeNull();await act(async()=>{element!.dispatchEvent(new window.Event('click',{bubbles:true}));});};
  return {document,click,fetcher};
}
describe('one shared publishing dialog',()=>{
 it('opens TikTok only with the explicit server-provided administrator flag',async()=>{
  const {document,click}=await render({youtubeEnabled:true,tiktokEnabled:true});
  await click('.publish-trigger'); await click('.publish-tabs button:nth-child(2)');
  expect(document.querySelector('[data-platform="tiktok"]')).not.toBeNull();
  await click('.publish-tabs button:nth-child(3)');
  expect(document.body.textContent).toContain('This platform is coming soon.');
 });
 it('keeps TikTok unavailable for defaults and other publishing grants',async()=>{
  const {document,click,fetcher}=await render({metaOnly:false,metaEnabled:true});
  await click('.publish-trigger'); await click('.publish-tabs button:nth-child(2)');
  expect(document.querySelector('[data-platform="tiktok"]')).toBeNull();
  expect(document.body.textContent).toContain('This platform is coming soon.');
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('restores the administrator TikTok tab after OAuth',async()=>{
  const {document}=await render({tiktokEnabled:true},"tiktok");
  expect(document.querySelector('.publish-tabs .is-active')?.textContent).toBe('TikTok');
  expect(document.querySelector('[data-platform="tiktok"]')).not.toBeNull();
  expect(document.querySelectorAll('dialog').length).toBe(1);
 });
 it('does not grant TikTok access through an OAuth return URL',async()=>{
  const {document,fetcher}=await render({},"tiktok");
  expect(document.querySelector('[data-platform="tiktok"]')).toBeNull();
  expect(document.body.textContent).toContain('This platform is coming soon.');
  expect(fetcher).not.toHaveBeenCalled();
 });

 it('places YouTube first and opens its existing connection panel inside the same dialog',async()=>{
  const {document,click}=await render({youtubeEnabled:true});
  expect(document.querySelectorAll('dialog').length).toBe(0);
  await click('.publish-trigger');
  expect(Array.from(document.querySelectorAll('.publish-tabs button')).map(x=>visibleLabel(x as unknown as Element))).toEqual(['YouTube','TikTok','Instagram','Threads']);
  expect(document.querySelector('.publish-tabs .is-active')?.textContent).toBe('YouTube');
  expect(document.querySelectorAll('dialog').length).toBe(1);
  expect(document.querySelectorAll('.publish-trigger').length).toBe(1);
  expect(document.body.textContent).toContain('Connect your YouTube channel');
  await click('.publish-tabs button:nth-child(2)');expect(document.body.textContent).toContain('This platform is coming soon.');
  await click('.publish-tabs button:nth-child(3)');expect(document.body.textContent).toContain('This platform is coming soon.');
  await click('.publish-tabs button:nth-child(4)');expect(document.body.textContent).toContain('This platform is coming soon.');
  await click('.publish-close');await click('.publish-trigger');
  expect(document.querySelector('.publish-tabs .is-active')?.textContent).toBe('YouTube');
 });
 it('restores the shared YouTube tab after OAuth without creating a nested dialog',async()=>{
  const {document}=await render({youtubeEnabled:true},"youtube");
  expect(document.querySelector('.publish-tabs .is-active')?.textContent).toBe('YouTube');
  expect(document.querySelectorAll('dialog').length).toBe(1);
  expect(document.body.textContent).toContain('Your channel is connected.');
 });
 it('shows coming-soon placeholders without requesting platform data when YouTube is unavailable',async()=>{
  const {document,click,fetcher}=await render({metaOnly:true});await click('.publish-trigger');
  expect(Array.from(document.querySelectorAll('.publish-tabs button')).map(x=>visibleLabel(x as unknown as Element))).toEqual(['YouTube','TikTok','Instagram','Threads']);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('shows placeholders for other platforms even for a YouTube-only account',async()=>{
  const {document,click}=await render({youtubeEnabled:true,metaOnly:true,metaEnabled:false});await click('.publish-trigger');
  expect(Array.from(document.querySelectorAll('.publish-tabs button')).map(x=>visibleLabel(x as unknown as Element))).toEqual(['YouTube','TikTok','Instagram','Threads']);
  expect(document.querySelectorAll('dialog').length).toBe(1);
 });
});
