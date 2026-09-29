import { afterEach, expect, it, vi } from "vitest";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {parseHTML} from "linkedom";
import {YoutubeAccountUpload} from "./youtube-account-upload";
vi.mock("@/lib/i18n/provider",()=>({useI18n:()=>({locale:"ko"})}));
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;vi.unstubAllGlobals();});
it("opens progress immediately, prevents duplicate sending and reports actual visibility",async()=>{
 const {window,document}=parseHTML('<html><body><div id="app"></div></body></html>');
 Object.defineProperty(window,"location",{configurable:true,value:new URL("https://www.easycut.co.kr/projects/1")});
 Object.assign(window.HTMLElement.prototype,{showModal(this:HTMLElement){this.setAttribute("open","");},close(this:HTMLElement){this.removeAttribute("open");}});
 Object.defineProperty(window,"innerHeight",{value:900,configurable:true});
 Object.assign(window.HTMLElement.prototype,{getBoundingClientRect(){return {top:100,bottom:150,left:0,right:300,width:300,height:50};}});
 vi.stubGlobal("window",window);vi.stubGlobal("document",document);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 vi.stubGlobal("sessionStorage",{getItem:()=>null,setItem:vi.fn()});
 let finish!:(value:Response)=>void;const pending=new Promise<Response>(resolve=>{finish=resolve;});
 const request=vi.fn(async(_url:string,init?:RequestInit)=>init?.method==="POST"?pending:Response.json({uploads:[],capabilities:{nonPrivateUploads:true}}));vi.stubGlobal("fetch",request);
 root=createRoot(document.getElementById("app")! as unknown as Element);
 await act(async()=>{root!.render(<YoutubeAccountUpload shortId="short-a" title="My clip" connections={[{id:"c",channelId:"UCtest",channelTitle:"My channel",status:"active"}]} attribution={{title:"Source title",author:"Source author",url:"https://www.youtube.com/watch?v=F-Dp78NJwlU",ccBy:true}} onManage={()=>{}}/>);});
 expect(document.querySelector("textarea")?.textContent).toContain("CC BY");
 await act(async()=>{document.querySelector("form")!.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));});
 expect(request.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
 for(const label of ["아동용 콘텐츠","사실적인 변경·합성 콘텐츠"]){
  await act(async()=>{document.querySelector(`[role="combobox"][aria-label="${label}"]`)!.dispatchEvent(new window.Event("click",{bubbles:true}));});
  await act(async()=>{document.querySelectorAll('[role="option"]')[1].dispatchEvent(new window.Event("click",{bubbles:true}));});
 }
 expect(document.querySelectorAll("select")).toHaveLength(0);
 await act(async()=>{document.querySelector("form")!.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));document.querySelector("form")!.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));});
 expect(document.querySelector(".publish-status-dialog.is-sending")).not.toBeNull();
 expect(request.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
 await act(async()=>{finish(Response.json({upload:{id:"upload-a",title:"My clip",status:"complete",requestedPrivacy:"public",actualPrivacy:"private",videoId:"F-Dp78NJwlU",error:null}}));});
 expect(document.querySelector(".publish-status-dialog.is-complete")).not.toBeNull();
 expect(document.querySelector(".publish-status-dialog")?.textContent).toContain("요청: 공개 · YouTube 확인: 비공개");
 expect(document.querySelector('.publish-status-dialog a')?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=F-Dp78NJwlU");
 expect(document.querySelector('footer button')?.getAttribute("type")).toBe("button");
});
