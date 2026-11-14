'use client';
import { Children, Fragment, forwardRef, isValidElement, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type SelectHTMLAttributes } from 'react';
import styles from './admin-select.module.css';
type Option={value:string;label:string;disabled:boolean};
function text(node:ReactNode):string {return Children.toArray(node).map(c=>isValidElement<{children?:ReactNode}>(c)?text(c.props.children):String(c)).join('');}
export function adminSelectOptions(children:ReactNode,disabled=false):Option[] {
 return Children.toArray(children).flatMap(child=>{
  if(!isValidElement<{children?:ReactNode;value?:string|number;disabled?:boolean}>(child))return [];
  if(child.type===Fragment||child.type==='optgroup')return adminSelectOptions(child.props.children,disabled||!!child.props.disabled);
  if(child.type!=='option')return [];
  return [{value:String(child.props.value??text(child.props.children)),label:text(child.props.children),disabled:disabled||!!child.props.disabled}];
 });
}
// The hidden native field preserves existing form submission, validation and React change handlers.
export const AdminSelect=forwardRef<HTMLButtonElement,Omit<SelectHTMLAttributes<HTMLSelectElement>,'multiple'|'size'>>(function AdminSelect(props,forwardedRef){
 const {children,className,id,style,value,defaultValue,onChange,disabled,autoFocus,...rest}=props;
 const uid=useId(),trigger=useRef<HTMLButtonElement>(null),native=useRef<HTMLSelectElement>(null),popup=useRef<HTMLDivElement>(null),search=useRef<HTMLInputElement>(null);
 useImperativeHandle(forwardedRef,()=>trigger.current!);
 const options=adminSelectOptions(children),[local,setLocal]=useState(String(defaultValue??options[0]?.value??''));
 const selected=String(value??local),[open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0),[position,setPosition]=useState({left:0,top:0,width:200,maxHeight:280});
 const filtered=options.filter(o=>o.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const listId=`${uid}-list`,buttonId=id||`${uid}-trigger`;
 const [labelId,setLabelId]=useState<string|undefined>();
 useEffect(()=>{const label=trigger.current?.closest('label');if(label){if(!label.id)label.id=`${uid}-label`;setLabelId(label.id);}},[uid]);
 useEffect(()=>{const node=native.current;const form=node?.form;const reset=()=>queueMicrotask(()=>{if(node)setLocal(node.value);});form?.addEventListener('reset',reset);return()=>form?.removeEventListener('reset',reset);},[]);
 useEffect(()=>{if(autoFocus)trigger.current?.focus({preventScroll:true});},[autoFocus]);
 useEffect(()=>{
  if(!open||disabled){popup.current?.hidePopover?.();return;}
  const menu=popup.current;if(!menu)return;
  const place=()=>{const r=trigger.current?.getBoundingClientRect();if(!r)return;const width=Math.min(Math.max(r.width,220),window.innerWidth-24),below=window.innerHeight-r.bottom-12,above=r.top-12,up=below<220&&above>below,height=Math.min(320,Math.max(100,up?above:below));setPosition({left:Math.max(12,Math.min(r.left,window.innerWidth-width-12)),top:up?Math.max(12,r.top-height-6):r.bottom+6,width,maxHeight:height});};
  place();menu.showPopover?.();
  const outside=(e:PointerEvent)=>{if(!menu.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};
  const focus=(e:FocusEvent)=>{if(!menu.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',outside);document.addEventListener('focusin',focus);window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
  return()=>{if(menu.isConnected)menu.hidePopover?.();document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',focus);window.removeEventListener('resize',place);document.removeEventListener('scroll',place,true);};
 },[open,disabled]);
 useEffect(()=>{if(open)popup.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({block:'nearest'});},[active,open]);
 function expand(){if(disabled||trigger.current?.matches(':disabled'))return;setQuery('');setActive(Math.max(0,options.findIndex(o=>o.value===selected)));setOpen(true);}
 function choose(option:Option){if(option.disabled||disabled)return;const field=native.current;if(field){field.value=option.value;field.dispatchEvent(new Event('change',{bubbles:true}));}setLocal(option.value);setOpen(false);trigger.current?.focus({preventScroll:true});}
 function keyboard(e:React.KeyboardEvent){
  if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus({preventScroll:true});return;}
  if(e.key==='Tab'){setOpen(false);return;}
  if(e.key==='Backspace'&&open&&e.target!==search.current){e.preventDefault();setQuery(q=>q.slice(0,-1));setActive(0);return;}
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();if(!open){expand();return;}const step=e.key==='ArrowUp'?-1:1;let next=e.key==='Home'?0:e.key==='End'?filtered.length-1:(active+step+filtered.length)%filtered.length;for(let i=0;i<filtered.length&&filtered[next]?.disabled;i++)next=(next+step+filtered.length)%filtered.length;setActive(next);}
  else if((e.key==='Enter'||e.key===' ')&&e.target!==search.current){e.preventDefault();if(open&&filtered[active])choose(filtered[active]);else expand();}
  else if(e.key==='Enter'&&e.target===search.current){e.preventDefault();if(filtered[active])choose(filtered[active]);}
  else if(e.key.length===1&&!e.metaKey&&!e.ctrlKey&&e.target!==search.current){e.preventDefault();if(!open)expand();setQuery(q=>open?q+e.key:e.key);setActive(0);}
 }
 return <span className={styles.root}>
  <select {...rest} id={`${buttonId}-native`} ref={native} tabIndex={-1} aria-hidden="true" style={{display:'none'}} value={value} defaultValue={defaultValue} disabled={disabled} onChange={e=>{setLocal(e.target.value);onChange?.(e);}} onInvalid={e=>{e.preventDefault();trigger.current?.focus();}}>{children}</select>
  <button ref={trigger} id={buttonId} type="button" role="combobox" className={`${className||''} ${styles.trigger}`} style={style} disabled={disabled} aria-label={props['aria-label']||(!labelId&&!id?(props.name||'선택'):undefined)} aria-labelledby={props['aria-labelledby']||(!props['aria-label']?labelId:undefined)} aria-describedby={props['aria-describedby']} aria-required={props.required||undefined} aria-expanded={open&&!disabled} aria-haspopup="listbox" aria-controls={open?listId:undefined} aria-activedescendant={open&&filtered[active]?`${uid}-option-${active}`:undefined} onClick={()=>open?setOpen(false):expand()} onKeyDown={keyboard}>
   <span>{options.find(o=>o.value===selected)?.label||options[0]?.label||'선택'}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20"><path d="m5 7 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg>
  </button>
  <div ref={popup} popover="manual" hidden={!open||disabled} className={styles.menu} style={position} onKeyDown={keyboard}>
   {options.length>8&&<input ref={search} className={styles.search} aria-label="옵션 검색" placeholder="검색해서 찾기" value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}}/>}
   <div role="listbox" id={listId} aria-labelledby={buttonId}>{filtered.map((option,index)=><div id={`${uid}-option-${index}`} data-option-index={index} key={`${option.value}-${index}`} role="option" aria-selected={option.value===selected} aria-disabled={option.disabled||undefined} className={`${styles.option} ${active===index?styles.active:''}`} onPointerMove={()=>setActive(index)} onClick={()=>choose(option)}><span>{option.label}</span><span aria-hidden="true">{option.value===selected?'✓':''}</span></div>)}{!filtered.length&&<p className={styles.empty}>일치하는 항목이 없습니다.</p>}</div>
  </div>
 </span>;
});
