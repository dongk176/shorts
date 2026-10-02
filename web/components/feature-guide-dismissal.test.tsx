import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { FeatureGuideOverlay } from "./feature-guide-overlay";
vi.mock("@/lib/i18n/use-ui-text",()=>({useUiText:()=>((text:string)=>text)}));
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;vi.useRealTimers();vi.unstubAllGlobals();});
it.each(["close","confirm","escape","primary"])("remembers %s after remount without invoking an unrelated primary action",async action=>{
 const {window,document}=parseHTML('<html><body><div id="app"></div></body></html>');
 const values=new Map<string,string>();
 vi.stubGlobal("window",window);vi.stubGlobal("document",document);vi.stubGlobal("HTMLElement",window.HTMLElement);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem:(key:string)=>values.get(key),setItem:(key:string,value:string)=>values.set(key,value)}});
 vi.useFakeTimers();
 const onPrimary=vi.fn(),onClose=vi.fn();
 const render=()=>root!.render(<FeatureGuideOverlay enabled storageKey="dismiss-test" closeAriaLabel="닫기" steps={[{id:"one",eyebrow:"안내",title:"편집 안내",description:"소개",targetSelector:null}]} onClose={onClose} onLastStepPrimaryAction={onPrimary}/>);
 root=createRoot(document.getElementById("app")! as unknown as Element);
 await act(async()=>render());await act(async()=>vi.advanceTimersByTime(400));
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();
 await act(async()=>{
  if(action==="escape") { const event=new window.Event("keydown",{bubbles:true});Object.defineProperty(event,"key",{value:"Escape"});document.querySelector('[role="dialog"]')!.dispatchEvent(event); }
  else {const buttons=Array.from(document.querySelectorAll("button"));const button=action==="close"?buttons[0]:buttons.find(b=>b.textContent===(action==="confirm"?"확인":"다시 보지 않기"))!;button.dispatchEvent(new window.Event("click",{bubbles:true}));}
 });
 expect(values.get("dismiss-test")).toBe("1");expect(onClose).toHaveBeenCalledTimes(1);expect(onPrimary).toHaveBeenCalledTimes(action==="primary"?1:0);
 await act(async()=>root!.unmount());root=createRoot(document.getElementById("app")! as unknown as Element);
 await act(async()=>render());await act(async()=>vi.advanceTimersByTime(400));
 expect(document.querySelector('[role="dialog"]')).toBeNull();
});
