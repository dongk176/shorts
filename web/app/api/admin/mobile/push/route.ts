import { getDb } from "@/lib/db";
import { authorizeMobile, mobileBody, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
import { endpointSchema, preferenceSchema, pushConfigured, subscriptionSchema } from "@/lib/admin-mobile-contract";
import { endpointHash, mobilePreferences, registerMobileSubscription, saveMobilePreferences } from "@/lib/admin-mobile-push";
import { HttpError } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const admin = await authorizeMobile();
    const device = new URL(request.url).searchParams.get("device");
    const rows = await getDb()`select endpoint from shorts_mvp.admin_mobile_subscriptions where admin_id=${admin.id} and active and transport='web'`;
    return mobileJSON({ configured: pushConfigured(), publicKey: process.env.ADMIN_PUSH_VAPID_PUBLIC_KEY || null,
      subscribed: !!device && rows.some(row => endpointHash(String(row.endpoint)) === device),
      preferences: await mobilePreferences(admin.id) });
  } catch (error) { return mobileError(error); }
}
export async function POST(request: Request) {
  try {
    const admin = await authorizeMobile(request);
    if (!pushConfigured()) throw new HttpError(503, "푸시알림 연결을 준비하고 있어요.");
    const { subscription } = await mobileBody(request);
    const id = await registerMobileSubscription(admin.id, subscriptionSchema.parse(subscription));
    return mobileJSON({ ok: true, id });
  } catch (error) { return mobileError(error); }
}
export async function PATCH(request: Request) {
  try {
    const admin = await authorizeMobile(request);
    const { preferences } = await mobileBody(request);
    await saveMobilePreferences(admin.id, preferenceSchema.parse(preferences));
    return mobileJSON({ ok: true });
  } catch (error) { return mobileError(error); }
}
export async function DELETE(request: Request) {
  try {
    const admin = await authorizeMobile(request);
    const endpoint = endpointSchema.parse((await mobileBody(request)).endpoint);
    await getDb()`update shorts_mvp.admin_mobile_subscriptions set active=false,updated_at=now()
      where admin_id=${admin.id} and endpoint=${endpoint}`;
    return mobileJSON({ ok: true });
  } catch (error) { return mobileError(error); }
}
