import { authorizeMobile, mobileBody, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
import { endpointSchema } from "@/lib/admin-mobile-contract";
import { testMobilePush } from "@/lib/admin-mobile-push";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const admin = await authorizeMobile(request);
    const endpoint = endpointSchema.parse((await mobileBody(request)).endpoint);
    await testMobilePush(admin.id, endpoint);
    return mobileJSON({ ok: true });
  } catch (error) { return mobileError(error); }
}
