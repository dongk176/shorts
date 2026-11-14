import { afterEach,expect,it,vi } from 'vitest';
import { act,useState } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { AdminSelect,adminSelectOptions } from './admin-select';
let root:Root|undefined;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;vi.unstubAllGlobals();});
it('flattens dynamic options and preserves disabled groups',()=>{expect(adminSelectOptions(<><option value="a">한국어</option><optgroup label="그룹" disabled><option value="b">일본어</option></optgroup>{['영어'].map(x=><option key={x}>{x}</option>)}</>)).toEqual([{value:'a',label:'한국어',disabled:false},{value:'b',label:'일본어',disabled:true},{value:'영어',label:'영어',disabled:false}]);});
it('preserves form values and React handlers, keyboard selection, focus and dismissal',async()=>{
 const {window,document}=parseHTML('<html><body><div id="app"></div><button id="outside">밖</button></body></html>');
 Object.assign(window.HTMLElement.prototype,{showPopover(this:HTMLElement){this.setAttribute('data-open','true');},hidePopover(this:HTMLElement){this.removeAttribute('data-open');},getBoundingClientRect(){return {top:100,bottom:145,left:20,width:200};},focus(){Object.defineProperty(document,'activeElement',{value:this,configurable:true});},scrollIntoView(){}});
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||'';},set(v){for(const option of this.querySelectorAll('option')){if(option.getAttribute('value')===v)option.setAttribute('selected','');else option.removeAttribute('selected');}}});
 vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('Event',window.Event);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const changed=vi.fn(),submit=vi.fn(),outerEscape=vi.fn();
 function Fixture({disabled=false}:{disabled?:boolean}){const [value,setValue]=useState('ko');return <form onSubmit={submit} onKeyDown={e=>{if(e.key==='Escape')outerEscape();}}><label>이용 언어<AdminSelect name="locale" value={value} disabled={disabled} onChange={e=>{setValue(e.target.value);changed(e.target.value);}}><option value="ko">한국어</option><option value="ja">일본어</option><option value="en" disabled>영어</option></AdminSelect></label></form>;}
 root=createRoot(document.getElementById('app')! as unknown as Element);await act(async()=>root!.render(<Fixture/>));
 const button=document.querySelector('[role="combobox"]')!;
 const click=async(e:Element)=>act(async()=>{e.dispatchEvent(new window.Event('click',{bubbles:true}));});
 const key=async(value:string)=>act(async()=>{const e=new window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(e,'key',{value});button.dispatchEvent(e);});
 await key('ArrowDown');expect(button.getAttribute('aria-expanded')).toBe('true');await key('ArrowDown');await key('Enter');
 expect(changed).toHaveBeenCalledWith('ja');expect((document.querySelector('select') as unknown as HTMLSelectElement).value).toBe('ja');expect(submit).not.toHaveBeenCalled();expect(document.activeElement).toBe(button);
 await click(button);await key('Escape');expect(button.getAttribute('aria-expanded')).toBe('false');expect(outerEscape).not.toHaveBeenCalled();
 await click(button);await act(async()=>document.getElementById('outside')!.dispatchEvent(new window.Event('pointerdown',{bubbles:true})));expect(button.getAttribute('aria-expanded')).toBe('false');
 await act(async()=>root!.render(<Fixture disabled/>));expect(button.hasAttribute('disabled')).toBe(true);
});
