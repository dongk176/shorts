"use client";
import { useI18n } from "@/lib/i18n/provider";
import { createYoutubeText, youtubeMessage } from "@/lib/youtube-accounts/i18n";
import { useEffect, useId, useState } from "react";
import type { Connection } from "@/lib/youtube-accounts/contracts";
import { PlatformIcon, UploadIcon } from "./publish-ui";
import { isPrivacy, privacyValues, privacyLabels, privacyDescriptions, privacyResult, type Privacy } from "@/lib/youtube-accounts/visibility";
type Upload={requestedPrivacy:Privacy|null;actualPrivacy:Privacy|null;privacyCheckedAt:string|null;id:string;title:string;status:string;videoId:string|null;error:string|null};
const labels:Record<string,string>={queued:"대기 중",uploading:"업로드 중",processing:"YouTube 처리 중",complete:"업로드 완료",interrupted:"확인 필요",expired:"보관 기간 종료 · 기존 영상은 YouTube에서 확인해 주세요"};
export function YoutubeAccountUpload({shortId,title:initialTitle,connections,previewUrl,onManage}:{shortId:string;title:string;connections:Connection[];previewUrl?:string;onManage:()=>void}){
 const {locale}=useI18n(); const yt=createYoutubeText(locale);
 const [title,setTitle]=useState(initialTitle),[description,setDescription]=useState("");
 const [privacy,setPrivacy]=useState<Privacy>("private"),[nonPrivateUploads,setNonPrivateUploads]=useState(false);
 const [connectionId,setConnectionId]=useState(""),[kids,setKids]=useState(""),[synthetic,setSynthetic]=useState("");
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[loaded,setLoaded]=useState(false);
 const [uploads,setUploads]=useState<Upload[]>([]),[expired,setExpired]=useState(false);
 const formId=useId(),key=`easycut-publish-draft:${shortId}`;
 const descriptionBytes=new TextEncoder().encode(description).length;
 const visibilityBlocked=privacy!=="private"&&!nonPrivateUploads;
 const active=connections.filter(c=>c.status==="active");
 const selected=active.some(c=>c.id===connectionId)?connectionId:active[0]?.id||"";
 useEffect(()=>{try{const d=JSON.parse(sessionStorage.getItem(key)||"null");if(d?.expires>Date.now()&&typeof d.title==="string"&&typeof d.description==="string"){setConnectionId(typeof d.connectionId==="string"?d.connectionId:"");setPrivacy(isPrivacy(d.privacy)?d.privacy:"private");setTitle(d.title.slice(0,100));setDescription(d.description.slice(0,5000));setKids(["yes","no"].includes(d.kids)?d.kids:"");setSynthetic(["yes","no"].includes(d.synthetic)?d.synthetic:"");}}catch{/* A draft is optional. */}setLoaded(true);},[key]);
 useEffect(()=>{if(!loaded)return;try{sessionStorage.setItem(key,JSON.stringify({title,description,connectionId,kids,synthetic,privacy,expires:Date.now()+20*60_000}));}catch{/* Keep edits in memory if storage is unavailable. */}},[key,loaded,title,description,connectionId,kids,synthetic,privacy]);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const load=async()=>{try{const r=await fetch(`/api/youtube/accounts/uploads?shortId=${shortId}`,{cache:"no-store",signal:controller.signal});if(r.status===401){setExpired(true);return;}const b=await r.json();if(!r.ok)throw Error(b.detail||"업로드 기록을 불러오지 못했습니다.");if(!controller.signal.aborted){setUploads(b.uploads);setNonPrivateUploads(b.capabilities?.nonPrivateUploads===true);if(b.uploads.some((u:Upload)=>["queued","uploading","processing"].includes(u.status)))timer=setTimeout(()=>void load(),5000);}}catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:"기록을 불러오지 못했습니다.");}};
  void load();return()=>{controller.abort();clearTimeout(timer);};
 },[shortId,busy]);
 async function submit(id?:string){
  if(!id&&(visibilityBlocked||descriptionBytes>5000)){setMessage(visibilityBlocked?"현재는 비공개 업로드만 가능합니다.":"설명은 5,000바이트 이하로 입력해 주세요.");return;}
  setBusy(true);setMessage("");
  try{
   const r=await fetch(id?`/api/youtube/accounts/uploads/${id}/resume`:"/api/youtube/accounts/uploads",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(id?{}:{shortId,connectionId:selected,title,description,privacy,madeForKids:kids==="yes",synthetic:synthetic==="yes"})});
   const b=await r.json();if(r.status===401)setExpired(true);if(!r.ok)throw Error(b.detail||"업로드를 완료하지 못했습니다.");
   setUploads(items=>[b.upload,...items.filter(x=>x.id!==b.upload.id)]);setMessage(b.upload.status==="complete"?"업로드를 완료했습니다.":labels[b.upload.status]||"상태를 확인해 주세요.");
  }catch(e){setMessage(e instanceof Error?e.message:"업로드를 완료하지 못했습니다.");}finally{setBusy(false);}
 }
 return <>
  <div className="publish-compose">
   <form id={formId} className="publish-fields" onSubmit={e=>{e.preventDefault();void submit();}}>
    <div className="publish-field"><div className="publish-label-row"><label htmlFor={`${formId}-channel`}>{yt("업로드할 채널")}</label><button type="button" className="publish-text-button" onClick={onManage}>{yt("채널 관리")}</button></div><div className="publish-channel-select"><PlatformIcon/><select id={`${formId}-channel`} value={selected} onChange={e=>setConnectionId(e.target.value)} disabled={busy}>{active.map(c=><option key={c.id} value={c.id}>{c.channelTitle}</option>)}</select><span className="publish-connected">{yt("연결됨")}</span></div></div>
    <div className="publish-field"><label htmlFor={`${formId}-title`}>{yt("제목")}<span>*</span></label><input id={`${formId}-title`} value={title} onChange={e=>setTitle(e.target.value)} maxLength={100} required disabled={busy} placeholder={yt("영상 제목을 입력해 주세요")}/><span className="publish-count">{title.length} / 100</span></div>
    <div className="publish-field"><label htmlFor={`${formId}-description`}>{yt("설명")}</label><textarea id={`${formId}-description`} value={description} onChange={e=>setDescription(e.target.value)} maxLength={5000} aria-invalid={descriptionBytes>5000} rows={4} disabled={busy} placeholder={yt("영상에 대한 설명을 작성해 주세요. #해시태그")}/><span className="publish-count">{descriptionBytes.toLocaleString()} {yt("/ 5,000바이트")}</span></div>
    <div className="publish-field"><label htmlFor={`${formId}-privacy`}>{yt("공개 범위")}</label><select id={`${formId}-privacy`} value={privacy} onChange={e=>{if(isPrivacy(e.target.value))setPrivacy(e.target.value);}} disabled={busy} aria-describedby={`${formId}-privacy-help`}>{privacyValues.map(value=><option key={value} value={value}>{yt(privacyLabels[value])}</option>)}</select><p id={`${formId}-privacy-help`} className="publish-note">{yt(privacyDescriptions[privacy])}</p>{!nonPrivateUploads&&<p className="publish-note">{yt("현재는 비공개 업로드만 가능합니다. 공개·일부 공개 업로드는 심사 승인 후 지원합니다.")}</p>}{visibilityBlocked&&<p role="status" className="publish-notice">{yt("{privacy} 업로드는 아직 사용할 수 없습니다. 지금 업로드하려면 비공개를 선택해 주세요.",{privacy:yt(privacyLabels[privacy])})}</p>}</div>
    <div className="publish-form-grid"><div className="publish-field"><label htmlFor={`${formId}-kids`}>{yt("아동용 콘텐츠")}<span>*</span></label><select id={`${formId}-kids`} required value={kids} onChange={e=>setKids(e.target.value)} disabled={busy}><option value="">{yt("선택해 주세요")}</option><option value="no">{yt("아니요, 아동용이 아닙니다")}</option><option value="yes">{yt("예, 아동용입니다")}</option></select></div><div className="publish-field"><label htmlFor={`${formId}-synthetic`}>{yt("사실적인 변경·합성 콘텐츠")}<span>*</span></label><select id={`${formId}-synthetic`} required value={synthetic} onChange={e=>setSynthetic(e.target.value)} disabled={busy}><option value="">{yt("선택해 주세요")}</option><option value="no">{yt("포함하지 않음")}</option><option value="yes">{yt("포함함")}</option></select></div></div>
    <p className="publish-note">{yt("실제처럼 보이도록 사람·장소·사건을 변경하거나 합성했다면 ‘포함함’을 선택하세요.")}</p>
   </form>
   <aside className="publish-preview"><div className="publish-preview-label">{yt("미리보기")}</div>{previewUrl?<video src={previewUrl} controls playsInline preload="metadata"/>:<div className="publish-preview-placeholder"><UploadIcon/></div>}<strong>{title||yt("영상 제목")}</strong><span><PlatformIcon/>{active.find(c=>c.id===selected)?.channelTitle}</span><small>{yt("프로젝트의 완성 영상이 업로드됩니다.")}</small></aside>
  </div>
  {expired?<div role="alert" className="publish-notice">{yt("다시 로그인하면 업로드 기록을 이어서 확인할 수 있어요.")}<button className="publish-text-button" onClick={()=>window.location.reload()}>{yt("로그인하기")}</button></div>:message&&<p role="status" className="publish-notice">{youtubeMessage(message,locale)}</p>}
  <p className="publish-note">{yt("업로드 상세 정보는 29일 뒤 삭제합니다. 중복 업로드 방지를 위한 최소 기록만 남으며, YouTube에 올린 영상은 유지됩니다.")}</p>
  {uploads.length>0&&<details className="publish-history"><summary>{yt("업로드 기록")}<span>{uploads.length}</span></summary><ul>{uploads.map(u=><li key={u.id}><span className={`publish-result-dot ${u.status==="complete"?"is-complete":""}`}/><div><strong data-i18n-content>{u.status === "expired" ? yt("이전 업로드") : u.title}</strong><small>{yt(labels[u.status] || "확인 필요")} · {u.requestedPrivacy?privacyResult(u.requestedPrivacy,u.actualPrivacy,locale):""}</small>{u.actualPrivacy&&u.actualPrivacy!==u.requestedPrivacy&&<p>{yt("선택한 공개 범위와 YouTube 확인 결과가 다릅니다. 영상 보기에서 확인해 주세요.")}</p>}{u.privacyCheckedAt&&<small>{yt("확인 시각:")} {new Date(u.privacyCheckedAt).toLocaleString(locale === "en" ? "en-US" : locale === "ja" ? "ja-JP" : "ko-KR")}</small>}{u.error&&<p>{youtubeMessage(u.error,locale)}</p>}</div>{u.videoId&&<a href={`https://www.youtube.com/watch?v=${encodeURIComponent(u.videoId)}`} target="_blank" rel="noreferrer" className="publish-text-button">{yt("영상 보기 ↗")}</a>}{(["processing","interrupted"].includes(u.status)||(u.status==="complete"&&!u.actualPrivacy))&&<button className="publish-outline" disabled={busy||expired} onClick={()=>void submit(u.id)}>{yt("상태 확인")}</button>}</li>)}</ul></details>}
  <footer className="publish-dialog-footer"><p>{busy?yt("업로드 상태를 확인하고 있어요."):yt("YouTube · {privacy} 업로드",{privacy:yt(privacyLabels[privacy])})}</p><button form={formId} className="publish-primary" type="submit" disabled={busy||expired||visibilityBlocked||descriptionBytes>5000||!selected||!kids||!synthetic||!title.trim()}><UploadIcon/>{busy?yt("업로드 중…"):yt("업로드하기")}</button></footer>
 </>;
}
