import { authorizedMobileCron, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
import { pushConfigured } from "@/lib/admin-mobile-contract";
import { dispatchMobilePushes, scanMobileEvents } from "@/lib/admin-mobile-monitor";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!authorizedMobileCron(request)) return mobileJSON({ error: "Unauthorized" },401);
  if (!pushConfigured()) return mobileJSON({ enabled: false });
  try {
    const scan = await scanMobileEvents();
    const delivery = await dispatchMobilePushes();
    return mobileJSON({ enabled: true, scan, delivery });
  } catch (error) { return mobileError(error); }
}
