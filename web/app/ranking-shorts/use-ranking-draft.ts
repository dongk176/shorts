"use client";
import { useEffect,useRef,useState } from "react";
import { parseRankingDraft,rankingDraftHasContent,rankingDraftKey,readRankingDraft,writeRankingDraft,type RankingDraft,type RankingDraftRecord } from "@/lib/ranking-draft";

export function useRankingDraft(owner:string,enabled:boolean,draft:RankingDraft,files:Record<string,File>,onRestore:(record:RankingDraftRecord)=>void){
 const [loaded,setLoaded]=useState(false);const [status,setStatus]=useState("임시 저장 준비 중…");const restore=useRef(onRestore);restore.current=onRestore;
 const queue=useRef<Promise<unknown>>(Promise.resolve());const generation=useRef(0);const saved=useRef("");const serialized=JSON.stringify(draft);
 useEffect(()=>{let alive=true;if(!enabled){setLoaded(true);return;}
  void (async()=>{let record:RankingDraftRecord|null=null;let failed=false;
   try{record=await readRankingDraft(owner);}catch{failed=true;}
   try{const raw=localStorage.getItem(rankingDraftKey(owner));const metadata=raw?parseRankingDraft(JSON.parse(raw)):null;if(raw==="null")record=null;else if(metadata)record={draft:metadata,files:record?.files||{}};}catch{failed=true;}
   if(!alive)return;if(record)restore.current(record);setStatus(failed?"임시 저장을 사용할 수 없어요. 이 창을 닫지 마세요.":record?"저장한 작업을 불러왔어요":"이 브라우저에 자동 저장");setLoaded(true);
  })();return()=>{alive=false;};
 },[owner,enabled]);
 useEffect(()=>{if(!loaded||!enabled)return;
  const content=rankingDraftHasContent(draft);const key=rankingDraftKey(owner);
  try{if(content)localStorage.setItem(key,serialized);else localStorage.setItem(key,"null");}catch{setStatus("임시 저장 공간이 부족해요. 이 창을 닫지 마세요.");}
  if(saved.current===serialized)return;const stamp=++generation.current;saved.current=serialized;setStatus(content?"저장 중…":"이 브라우저에 자동 저장");
  const ids=new Set([...draft.slots.flatMap(s=>s.source?[s.source.id]:[]),...(draft.music?[draft.music.id]:[])]);
  const record=content?{draft,files:Object.fromEntries(Object.entries(files).filter(([id])=>ids.has(id)))}:null;
  queue.current=queue.current.catch(()=>{}).then(()=>writeRankingDraft(owner,record)).then(()=>{if(generation.current===stamp)setStatus(content?"임시 저장됨 · 이 브라우저":"이 브라우저에 자동 저장");}).catch(()=>{saved.current="";if(generation.current===stamp)setStatus("임시 저장에 실패했어요. 이 창을 닫지 마세요.");});
 // The serialized snapshot is the complete dependency; avoid writing the same blobs on unrelated renders.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[loaded,enabled,owner,serialized,files]);
 async function clear(){generation.current++;localStorage.setItem(rankingDraftKey(owner),"null");saved.current="";queue.current=queue.current.catch(()=>{}).then(()=>writeRankingDraft(owner,null));await queue.current;}
 return {loaded,status,clear};
}
