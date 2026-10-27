import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {parseHTML} from "linkedom";
import {RankingResultPlayer} from "./ranking-result-player";
let root:Root;
const url='/api/ranking-shorts/dbda49ac-4033-4f4a-838d-98bfbf3daa90/media/c7852a91-2a2c-4c3f-bd0d-fcd5d3176b76?result=1';
beforeEach(()=>{const {window,document}=parseHTML('<html><body><div id="app"></div></body></html>');vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('HTMLElement',window.HTMLElement);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({handled:false})));root=createRoot(document.getElementById('app')!);});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
async function view(){await act(async()=>root.render(<RankingResultPlayer url={url}/>));await act(async()=>document.querySelector('video')!.dispatchEvent(new window.Event('ended',{bubbles:true})));}
it('waits until result is viewed and does not block playback',async()=>{await act(async()=>root.render(<RankingResultPlayer url={url}/>));expect(fetch).not.toHaveBeenCalled();expect(document.querySelector('section')).toBeNull();await view();expect(document.body.textContent).toContain('만들어진 영상은 어땠나요?');expect(document.querySelector('dialog')).toBeNull();});
it('does not prompt for an already handled render',async()=>{vi.mocked(fetch).mockResolvedValue(Response.json({handled:true}));await view();expect(document.querySelector('section')).toBeNull();});
it('keeps the form on submit failure and allows a retry',async()=>{await view();await act(async()=>Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='좋아요')!.click());vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, {status:500}));await act(async()=>document.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));expect(document.querySelector('[role=alert]')?.textContent).toContain('다시 시도');expect(document.querySelector('textarea')).not.toBeNull();await act(async()=>document.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));expect(document.querySelector('section')).toBeNull();expect(document.body.textContent).toContain('의견 감사합니다');});
it('records skip once and hides the form',async()=>{await view();await act(async()=>Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='건너뛰기')!.click());expect(document.querySelector('section')).toBeNull();const request=vi.mocked(fetch).mock.calls.at(-1)!;expect(JSON.parse(String(request[1]?.body))).toMatchObject({rating:null,comment:''});});
it('silently preserves video on feedback lookup failure',async()=>{vi.mocked(fetch).mockRejectedValue(Error('offline'));await view();expect(document.querySelector('video')).not.toBeNull();expect(document.querySelector('section')).toBeNull();});
