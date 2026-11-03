import { requireAdminUser } from "@/lib/admin";
import { inspectPayPalConfiguration } from "@/lib/paypal/configuration-health";
import { apiError } from "@/lib/http";
import { NextResponse } from "next/server";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { oneTimeEnabled } from "@/lib/paypal/one-time-config";
import { configureOneTimeWebhook,inspectOneTimeLiveConfiguration } from "@/lib/paypal/one-time-diagnostics";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET() {
  try {
    await requireAdminUser();
    return NextResponse.json(oneTimeEnabled()?await inspectOneTimeLiveConfiguration():await inspectPayPalConfiguration(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error, "PayPal configuration could not be verified.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
export async function POST(request:Request) {
  try {
    assertBillingMutationRequest(request);await requireAdminUser();
    const body=z.object({action:z.enum(['configure_webhook','verify_unpaid_order'])}).strict().parse(await request.json());
    return NextResponse.json(body.action==='configure_webhook'?await configureOneTimeWebhook():await inspectOneTimeLiveConfiguration(true),{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){return apiError(error,'PayPal 설정 확인을 완료하지 못했습니다.');}
}
