"use client";
import { useEffect,useMemo,useRef,useState } from "react";
import { RankingResultPlayer } from "./ranking-result-player";
import { useRankingBackdrop } from "./use-ranking-backdrop";
import { RankingProjectList } from "@/components/ranking-project-list";
import type { RankingProjectSummary } from "@/lib/ranking-project-list";

export function RankingWorkspaceProjects({revision,submitted,preparing}:{revision:number;submitted:RankingProjectSummary|null;preparing:{title:string;message:string}|null}){
 const [projects,setProjects]=useState<RankingProjectSummary[]>([]);const [error,setError]=useState("");const [loading,setLoading]=useState(true);const [retry,setRetry]=useState(0);
 const [selected,setSelected]=useState<RankingProjectSummary|null>(null);const [detail,setDetail]=useState<{result?:{url:string;duration:number};error?:string}|null>(null);const [detailError,setDetailError]=useState("");const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const c=new AbortController();setError("");void fetch('/api/ranking-shorts',{cache:'no-store',signal:c.signal}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(!c.signal.aborted){setProjects(data.projects.filter((p:RankingProjectSummary)=>p.status!=="draft"));setLoading(false);}}).catch(()=>{if(!c.signal.aborted){setError("프로젝트를 불러오지 못했습니다.");setLoading(false);}});return()=>c.abort();},[revision,retry]);
 useEffect(()=>{if(!selected)return;const el=dialog.current;const focus=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow="hidden";el?.showModal();setDetail(null);setDetailError("");const c=new AbortController();void fetch(`/api/ranking-shorts/${selected.id}`,{cache:"no-store",signal:c.signal}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(!c.signal.aborted)setDetail(data);}).catch(()=>{if(!c.signal.aborted)setDetailError("영상을 불러오지 못했습니다. 다시 열어 주세요.");});return()=>{c.abort();el?.close();document.body.style.overflow=overflow;focus?.focus();};},[selected]);
 const backdrop = useRankingBackdrop(() => setSelected(null));
 const items=useMemo(()=>{const result=projects.filter(p=>p.status!=="draft");if(submitted&&!result.some(p=>p.id===submitted.id))result.unshift(submitted);return result;},[projects,submitted]);
 return <section className="ranking-workspace-projects" id="ranking-workspace-projects" tabIndex={-1} aria-label="랭킹 쇼츠 프로젝트">
  <div className="ranking-library-heading"><div><span>MY RANKING SHORTS</span><h2>랭킹 쇼츠 프로젝트</h2></div><p>제작 중인 영상부터 완성본까지, 여기에서 확인하세요.</p></div>
  {preparing?<div className="ranking-preparing-card" role="status"><span className="ranking-spinner" aria-hidden="true"/><div><strong>{preparing.title || "랭킹 쇼츠"}</strong><p>{preparing.message || "제작을 준비하고 있습니다…"}</p></div></div>:null}
  {error?<p role="alert">{error} <button type="button" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></p>:null}
  {items.length?<RankingProjectList projects={items} embedded onOpen={setSelected}/>:<div className="ranking-projects-empty">{loading?"프로젝트를 불러오고 있어요…":"영상을 만들면 여기에 차곡차곡 모여요."}</div>}
  {selected&&<dialog ref={dialog} {...backdrop} className="ranking-project-view" aria-label={selected.title||"랭킹 쇼츠 영상"} onCancel={()=>setSelected(null)}>
   <header><h2>{selected.title||"랭킹 쇼츠"}</h2><button type="button" aria-label="영상 닫기" onClick={()=>setSelected(null)}>×</button></header>
   {detailError?<p role="alert">{detailError}</p>:!detail?<p role="status">영상을 불러오고 있어요…</p>:detail.result?<><RankingResultPlayer url={detail.result.url}/><a href={`${detail.result.url}&download=1`} className="ranking-download-button">영상 다운로드 ↓</a></>:<p role="status">{detail.error||"영상을 만들고 있어요. 완료되면 프로젝트에서 확인할 수 있습니다."}</p>}
  </dialog>}
 </section>;
}
