import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { mobileBody, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
import { createNativeCode } from "@/lib/admin-native-auth";
import { nativeAuthSchema } from "@/lib/admin-native-contract";
import { HttpError } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url=new URL(request.url);
  try {
    if(process.env.ADMIN_MOBILE_ENABLED!=="1")throw new HttpError(503,"관리자 앱 연결을 준비하고 있어요.");
    const input=nativeAuthSchema.parse(Object.fromEntries(url.searchParams));
    try { await requireAdminUser(); }
    catch(error) {
      if(error instanceof HttpError && error.status===401) {
        const login=new URL("/auth/sign-in",url.origin); login.searchParams.set("next",url.pathname+url.search);
        return NextResponse.redirect(login,303);
      }
      throw error;
    }
    const nonce=randomBytes(18).toString("base64");
    return new NextResponse(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EasyCut 로그인</title><style nonce="${nonce}">body{font:16px -apple-system,sans-serif;background:#f7f8fc;color:#252236;display:grid;place-items:center;min-height:90vh;margin:24px}main{max-width:360px;text-align:center}b{font-size:38px;color:#795bea}h1{font-size:24px;margin:22px 0 12px}p{line-height:1.7;color:#787485}button{border:0;border-radius:18px;padding:17px 32px;background:#795bea;color:white;font:600 16px -apple-system;width:100%;margin-top:16px}button:disabled{opacity:.5}</style><main><b>e.</b><h1>나의 작은 운영실.</h1><p>이 iPhone에서 관리자 앱에 로그인합니다.<br>결제와 운영 현황을 확인할 수 있어요.</p><button id="login">관리자 앱에 로그인</button><p id="message"></p></main><script nonce="${nonce}">document.getElementById('login').onclick=async function(){this.disabled=true;try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(input)})});const d=await r.json();if(!r.ok)throw Error(d.detail||'다시 시도해주세요.');location.href=d.callback;}catch(e){document.getElementById('message').textContent=e.message;this.disabled=false;}};</script></html>`,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`}});
  } catch(error) {return mobileError(error);}
}
export async function POST(request: Request) {
  try {
    if(process.env.ADMIN_MOBILE_ENABLED!=="1")throw new HttpError(503,"관리자 앱 연결을 준비하고 있어요.");
    if(request.headers.get("origin")!==new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json"))throw new HttpError(403,"요청 출처를 확인해주세요.");
    // Only an existing web login may grant a native session, never another native session.
    const admin=await requireAdminUser();
    const input=nativeAuthSchema.parse(await mobileBody(request));
    const code=await createNativeCode(admin.id,input.challenge);
    return mobileJSON({callback:`easycut-admin://auth?code=${code}&state=${input.state}`});
  }catch(error){return mobileError(error);}
}
