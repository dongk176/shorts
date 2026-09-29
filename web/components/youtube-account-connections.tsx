"use client";
import { useI18n } from "@/lib/i18n/provider";
import { createYoutubeText, youtubeMessage } from "@/lib/youtube-accounts/i18n";
import { localePath } from "@/lib/i18n/routing";
import { clearYoutubeDrafts } from "@/lib/youtube-accounts/browser-data";
import { useCallback, useEffect, useState } from "react";
import Link from "@/lib/i18n/navigation";

import type { YoutubeAttribution } from "@/lib/youtube-accounts/attribution";
import { YoutubeAccountUpload } from "./youtube-account-upload";
import { PlatformIcon } from "./publish-ui";
import type { Connection } from "@/lib/youtube-accounts/contracts";
import "./youtube-publish.css";
const RETURN_KEY="easycut-publish-return-v1";

export function YoutubeAccountConnections({ shortId, title, previewUrl }: { shortId?: string; title?: string; previewUrl?: string }) {
 const {locale}=useI18n(); const yt=createYoutubeText(locale);
 const [connections,setConnections]=useState<Connection[]>([]),[visible,setVisible]=useState(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [confirmDisconnect,setConfirmDisconnect]=useState<string|null>(null),[disconnectState,setDisconnectState]=useState("none");
 const [reconnectDeadline,setReconnectDeadline]=useState(0),[reconnectSeconds,setReconnectSeconds]=useState(0),[refresh,setRefresh]=useState(0);
 const updateReconnectDelay=useCallback((value:unknown)=>{
  const parsed=Number(value),seconds=Number.isFinite(parsed)?Math.max(0,Math.ceil(parsed)):0;
  setReconnectSeconds(seconds);setReconnectDeadline(seconds?Date.now()+seconds*1000:0);
 },[]);
 useEffect(()=>{
  if(!reconnectDeadline)return;
  const tick=()=>{
   const seconds=Math.max(0,Math.ceil((reconnectDeadline-Date.now())/1000));setReconnectSeconds(seconds);
   if(!seconds){setReconnectDeadline(0);setRefresh(value=>value+1);}
  };
  const timer=window.setInterval(tick,1000);window.addEventListener("focus",tick);
  return()=>{window.clearInterval(timer);window.removeEventListener("focus",tick);};
 },[reconnectDeadline]);
 const [managing,setManaging]=useState(false);
 const [attribution,setAttribution]=useState<YoutubeAttribution|null>(null);
 useEffect(()=>{
  const controller=new AbortController();
  fetch(`/api/youtube/accounts${shortId?`?shortId=${encodeURIComponent(shortId)}`:""}`,{cache:"no-store",signal:controller.signal}).then(async r=>{
   if(shortId&&[401,403,404].includes(r.status))return;
   const b=await r.json();if(!r.ok)throw Error(b.detail||"채널 정보를 불러오지 못했습니다.");
   if(!controller.signal.aborted){setConnections(b.connections);setAttribution(b.attribution || null);setDisconnectState(b.disconnectStatus||"none");updateReconnectDelay(b.reconnectAfterSeconds);setVisible(true);}
  }).catch(e=>{if(!controller.signal.aborted){setVisible(true);setMessage(e.message);}});
  const url=new URL(window.location.href),outcome=url.searchParams.get("youtubeAccount");
  if(outcome){
   let restore=!shortId;
   try{const saved=JSON.parse(sessionStorage.getItem(RETURN_KEY)||"null");restore=restore||saved?.shortId===shortId&&localePath(saved?.path||"").pathname===localePath(url.pathname).pathname&&saved?.expires>Date.now();if(restore)sessionStorage.removeItem(RETURN_KEY);}catch{/* Storage is optional for settings. */}
   if(restore){setMessage(outcome==="connected"?"채널이 연결되었습니다.":outcome==="cancelled"?"연결을 취소했습니다. 언제든 다시 연결할 수 있어요.":"연결을 완료하지 못했습니다. 다시 시도해 주세요.");url.searchParams.delete("youtubeAccount");window.history.replaceState(window.history.state,"",url);}
  }
  return()=>controller.abort();
 },[shortId,refresh,updateReconnectDelay]);
 async function connect(connectionId?:string){
  setBusy(true);setMessage("");
  try{
   if(shortId){try{sessionStorage.setItem(RETURN_KEY,JSON.stringify({shortId,path:window.location.pathname,expires:Date.now()+20*60_000}));}catch{/* OAuth can still proceed without optional restoration. */}}
   const r=await fetch("/api/youtube/accounts/oauth/start",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({returnPath:localePath(window.location.pathname).pathname,...(shortId?{shortId}:{}),...(connectionId?{connectionId}:{})})});
   const b=await r.json();
   if(r.status===409&&b.code==="YOUTUBE_RECONNECT_COOLDOWN"){
    updateReconnectDelay(Number(r.headers.get("Retry-After"))||1);setBusy(false);return;
   }
   if(!r.ok)throw Error(b.detail||"연결을 시작하지 못했습니다.");window.location.assign(b.authorizationUrl);
  }catch(e){setMessage(e instanceof Error?e.message:"연결을 시작하지 못했습니다.");setBusy(false);}
 }
 async function disconnect(id:string){
  setBusy(true);setMessage("");
  try{const r=await fetch(`/api/youtube/accounts/${id}`,{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({confirmAllConnections:true})});const b=await r.json();if(!r.ok)throw Error(b.detail||"연결 해제에 실패했습니다.");clearYoutubeDrafts();setConnections([]);setConfirmDisconnect(null);setDisconnectState(b.revocation);updateReconnectDelay(b.reconnectAfterSeconds);setMessage("YouTube 연결 정보와 게시 기록을 삭제했습니다. 이미 업로드한 영상과 프로젝트 원본은 유지됩니다.");}
  catch(e){setMessage(e instanceof Error?e.message:"연결 해제에 실패했습니다.");}finally{setBusy(false);}
 }
 if(!visible)return shortId?null:<p role="status" className="publish-muted">{yt("채널 정보를 불러오는 중…")}</p>;
 const active=connections.filter(c=>c.status==="active");
 const deletionNotice=<>{reconnectSeconds>0&&<p role="status" className="publish-notice">{yt("{seconds}초 뒤 YouTube 채널을 다시 연결할 수 있습니다.",{seconds:reconnectSeconds})}</p>}{disconnectState==="manual_required"&&<p role="status" className="publish-notice">{yt("이지컷의 연결 데이터는 삭제됐지만 Google 권한 해제는 확인하지 못했습니다.")}<a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">{yt("Google 계정에서 Easy Cut 연결을 해제해 주세요 ↗")}</a></p>}{disconnectState==="pending"&&<p role="status" className="publish-notice">{yt("Google 권한 해제를 확인 중입니다. 잠시 후 상태가 자동으로 갱신됩니다.")}<a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">{yt("Google 연결 관리 ↗")}</a></p>}</>;
 const channelCard=<div className="publish-channel-card">
  <div className="publish-card-heading"><span><PlatformIcon/>YouTube</span><button type="button" className="publish-outline" disabled={busy||reconnectSeconds>0} onClick={()=>void connect()}>{reconnectSeconds>0?yt("연결 대기 {seconds}초",{seconds:reconnectSeconds}):`＋ ${yt(active.length?"채널 추가":"연결하기")}`}</button></div>
  <details className="publish-note"><summary>{yt("연결 데이터 보관 안내")}</summary><p>{yt("연결 권한과 채널 정보를 정기적으로 확인합니다. 29일 동안 이 기능을 사용하지 않거나 연결을 확인할 수 없는 상태가 계속되면 연결 정보와 게시 기록을 삭제합니다. 다시 연결해서 사용할 수 있으며, YouTube에 올린 영상은 유지됩니다.")}</p></details>
  {connections.length?<ul className="publish-channel-list">{connections.map(c=><li key={c.id}><span className="publish-avatar">{c.channelTitle.slice(0,1)}</span><span className="publish-channel-name"><strong>{c.channelTitle}</strong><small>{c.status==="active"?yt("연결됨"):c.status==="disconnected"?yt("연결 해제됨"):yt("재연결 필요")}</small></span><button className="publish-text-button" disabled={busy||reconnectSeconds>0} onClick={()=>void connect(c.id)}>{yt("재연결")}</button>{c.status==="active"&&<button className="publish-text-button" disabled={busy} onClick={()=>setConfirmDisconnect(c.id)}>{yt("연결 해제")}</button>}</li>)}</ul>:<p className="publish-muted">{yt("연동된 계정 없음")}</p>}
  {confirmDisconnect&&<div className="publish-notice" role="group" aria-label={yt("YouTube 연결 해제 확인")}><strong>{yt("모든 YouTube 연결을 해제할까요?")}</strong><p>{yt("이 이지컷 계정의 모든 YouTube 연결 정보와 게시 기록을 삭제하고 Google 권한을 해제합니다. 진행 중인 업로드는 중단을 요청합니다. 이미 YouTube가 받은 영상은 남아 있을 수 있으며, 게시한 영상과 프로젝트 원본은 삭제하지 않습니다.")}</p><p>{yt("Google 권한 해제는 같은 Google 프로젝트의 다른 연결에도 영향을 줄 수 있습니다. 삭제한 게시 기록은 복구할 수 없습니다.")}</p><button type="button" className="publish-outline" disabled={busy} onClick={()=>setConfirmDisconnect(null)}>{yt("취소")}</button> <button type="button" className="publish-primary" disabled={busy} onClick={()=>void disconnect(confirmDisconnect)}>{busy?yt("해제하는 중…"):yt("모든 연결 해제 및 데이터 삭제")}</button></div>}
 </div>;
 if(!shortId)return <section data-i18n-skip className="publish-channels" aria-label={yt("연동된 채널")}>{deletionNotice}{channelCard}{message&&<p role="status" className="publish-notice">{youtubeMessage(message,locale)}</p>}</section>;
 return <div data-i18n-skip>
     {message&&<p role="status" className="publish-notice">{youtubeMessage(message,locale)}</p>}{deletionNotice}
     {!active.length?<div className="publish-connect-layout"><div className="publish-empty"><span className="publish-connect-symbol"><PlatformIcon/></span><h3>{yt("YouTube 채널을 연결해 주세요")}</h3><p>{yt("한 번 연결하면 프로젝트에서 바로 업로드할 수 있어요.")}</p><button className="publish-primary" disabled={busy||reconnectSeconds>0} onClick={()=>void connect()}>{busy?yt("연결하는 중…"):reconnectSeconds>0?yt("연결 대기 {seconds}초",{seconds:reconnectSeconds}):yt("＋ YouTube 연결하기")}</button><span className="publish-note">{yt("연결 후 이 화면에서 계속할 수 있습니다.")}</span></div><aside className="publish-preview">{previewUrl&&<video src={previewUrl} controls playsInline preload="metadata"/>}<strong data-i18n-content>{title ?? yt("이지컷 영상")}</strong><span>{yt("업로드할 영상")}</span></aside></div>:managing?<div className="publish-manage"><button className="publish-text-button" onClick={()=>setManaging(false)}>{yt("← 업로드 설정으로 돌아가기")}</button>{channelCard}<Link className="publish-text-button" href="/publish/channels">{yt("전체 채널 관리 ↗")}</Link></div>:<YoutubeAccountUpload attribution={attribution} shortId={shortId} title={title ?? yt("이지컷 영상")} connections={connections} previewUrl={previewUrl} onManage={()=>setManaging(v=>!v)}/>}
     {(!active.length&&connections.length>0)&&<div className="publish-manage">{channelCard}</div>}
 </div>;
}
