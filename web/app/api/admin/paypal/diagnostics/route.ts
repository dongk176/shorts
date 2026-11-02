import { requireAdminUser } from "@/lib/admin";
import { inspectPayPalConfiguration } from "@/lib/paypal/configuration-health";
import { apiError } from "@/lib/http";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET() {
  try {
    await requireAdminUser();
    return NextResponse.json(await inspectPayPalConfiguration(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error, "PayPal configuration could not be verified.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
