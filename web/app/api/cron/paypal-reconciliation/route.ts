import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { reconcilePayPal } from "@/lib/paypal/service";
import { reconcileOneTimeOrders } from "@/lib/paypal/one-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const expected = Buffer.from(process.env.CRON_SECRET || "");
  const authorization = request.headers.get("authorization") || "";
  const provided = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
  if (!expected.length || expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  try {
    const orders = await reconcileOneTimeOrders();
    const subscriptions = await reconcilePayPal();
    const result = {...subscriptions,orders,failed:orders.failed+subscriptions.failed};
    return NextResponse.json(result, { status: result.failed ? 500 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("paypal_reconciliation_failed");
    return NextResponse.json({ detail: "Reconciliation failed" }, { status: 500 });
  }
}
