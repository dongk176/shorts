import type { CSSProperties } from "react";
export const platforms = [
 {name:"YouTube",color:"#f04444",mark:"▶",note:""},
 {name:"Instagram",color:"#d163a5",mark:"◎",note:"비즈니스 또는 크리에이터 계정"},
 {name:"TikTok",color:"#b5bac5",mark:"♪",note:""},
 {name:"Threads",color:"#b5bac5",mark:"@",note:""},
 {name:"Facebook",color:"#5489e2",mark:"f",note:"Facebook 페이지"},
];
export function PlatformIcon({name="YouTube"}:{name?:string}) {
 const p=platforms.find(x=>x.name===name)||platforms[0];
 const icon=name==="YouTube"?<svg viewBox="0 0 24 24" fill="currentColor"><rect y="3" width="24" height="18" rx="5"/><path d="m10 8 6 4-6 4Z" fill="#0b0f15"/></svg>
  :name==="Instagram"?<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>
  :name==="TikTok"?<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2h3a5 5 0 0 0 5 5v3a8 8 0 0 1-5-1.7V16a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3Z"/></svg>
  :name==="Facebook"?<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M13.5 22v-8h3l.5-3h-3.5V9c0-1 .5-1.5 1.5-1.5H17V4.7a15 15 0 0 0-2.5-.2c-2.8 0-4.5 1.7-4.5 4.6V11H7v3h3v8Z" fill="#0b0f15"/></svg>:p.mark;
 return <span aria-hidden="true" className="publish-platform-icon" style={{"--platform-color":p.color} as CSSProperties}>{icon}</span>;
}
export function UploadIcon(){return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>;}

export function LockIcon(){return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>;}
