import { cookies } from "next/headers";
import { authorizeMobile, mobileBody, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
import { NATIVE_COOKIE, nativeHash } from "@/lib/admin-native-auth";
import { nativeInstallationSchema } from "@/lib/admin-native-contract";
import { getDb } from "@/lib/db";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function DELETE(request:Request) {
  try {
    const admin=await authorizeMobile(request);
    const installationId=nativeInstallationSchema.parse((await mobileBody(request)).installationId);
    const token=(await cookies()).get(NATIVE_COOKIE)?.value;
    await getDb().begin(async tx=>{
      if(token)await tx`delete from shorts_mvp.admin_native_sessions where token_hash=${nativeHash(token)} and admin_id=${admin.id}`;
      await tx`update shorts_mvp.admin_mobile_subscriptions set active=false,updated_at=now() where admin_id=${admin.id} and installation_id=${installationId}`;
    });
    const response=mobileJSON({ok:true});
    response.cookies.set(NATIVE_COOKIE,"",{httpOnly:true,secure:true,sameSite:"strict",path:"/api/admin/mobile",maxAge:0});
    return response;
  }catch(error){return mobileError(error);}
}
