import { mobileBody, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
import { exchangeNativeCode, NATIVE_COOKIE } from "@/lib/admin-native-auth";
import { nativeExchangeSchema } from "@/lib/admin-native-contract";
import { HttpError } from "@/lib/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request) {
  try {
    if(process.env.ADMIN_MOBILE_ENABLED!=="1")throw new HttpError(503,"관리자 앱 연결을 준비하고 있어요.");
    if(!request.headers.get("content-type")?.startsWith("application/json"))throw new HttpError(415,"JSON 요청이 필요합니다.");
    const input=nativeExchangeSchema.parse(await mobileBody(request));
    const token=await exchangeNativeCode(input.code,input.verifier);
    const response=mobileJSON({ok:true});
    response.cookies.set(NATIVE_COOKIE,token,{httpOnly:true,secure:true,sameSite:"strict",path:"/api/admin/mobile",maxAge:30*24*3600});
    return response;
  }catch(error){return mobileError(error);}
}
