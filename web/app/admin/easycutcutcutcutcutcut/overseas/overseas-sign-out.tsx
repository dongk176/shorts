"use client";
import { useState } from "react";
import { overseasPath } from "@/lib/admin-overseas-contract";

export function OverseasSignOut() {
  const [pending,setPending] = useState(false);
  const [failed,setFailed] = useState(false);
  return <div><button type="button" disabled={pending} className="text-xs text-neutral-400 underline disabled:opacity-50" onClick={async()=>{
    setPending(true);setFailed(false);
    try {
      const response=await fetch("/auth/sign-out",{method:"POST",headers:{"x-easycut-client-navigation":"1"},signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new Error();
      window.location.assign(`${overseasPath}/login`);
    } catch {setFailed(true);setPending(false);}
  }}>{pending?"로그아웃 중…":"로그아웃"}</button>{failed&&<p role="alert" className="text-xs text-amber-200">다시 시도해 주세요.</p>}</div>;
}
