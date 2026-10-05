import { authorizeMobile, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
import { loadAdminMobileOverview } from "@/lib/admin-mobile-overview";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const admin = await authorizeMobile();
    return mobileJSON(await loadAdminMobileOverview(admin.id));
  } catch (error) { return mobileError(error); }
}
