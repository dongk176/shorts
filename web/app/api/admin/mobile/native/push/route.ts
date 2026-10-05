import { getDb } from "@/lib/db";
import { authorizeMobile, mobileBody, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
import { apnsConfigured, nativeInstallationSchema } from "@/lib/admin-native-contract";
import { registerNativeDevice, testNativePush } from "@/lib/admin-native-push";
import { mobilePreferences } from "@/lib/admin-mobile-push";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const admin=await authorizeMobile();
    const id=nativeInstallationSchema.parse(new URL(request.url).searchParams.get("installationId"));
    const [row]=await getDb()`select active from shorts_mvp.admin_mobile_subscriptions where admin_id=${admin.id} and installation_id=${id} and transport='apns'`;
    return mobileJSON({configured:apnsConfigured(),subscribed:!!row?.active,preferences:await mobilePreferences(admin.id)});
  }catch(error){return mobileError(error);}
}
export async function POST(request:Request) {
  try {
    const admin=await authorizeMobile(request);
    const id=await registerNativeDevice(admin.id,await mobileBody(request));
    return mobileJSON({ok:true,id});
  }catch(error){return mobileError(error);}
}
export async function PATCH(request:Request) {
  try {
    const admin=await authorizeMobile(request);
    const id=nativeInstallationSchema.parse((await mobileBody(request)).installationId);
    await testNativePush(admin.id,id);
    return mobileJSON({ok:true});
  }catch(error){return mobileError(error);}
}
export async function DELETE(request:Request) {
  try {
    const admin=await authorizeMobile(request);
    const id=nativeInstallationSchema.parse((await mobileBody(request)).installationId);
    await getDb()`update shorts_mvp.admin_mobile_subscriptions set active=false,updated_at=now() where admin_id=${admin.id} and installation_id=${id} and transport='apns'`;
    return mobileJSON({ok:true});
  }catch(error){return mobileError(error);}
}
