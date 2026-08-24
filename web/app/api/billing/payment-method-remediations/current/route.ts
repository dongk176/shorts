import { NextResponse } from "next/server";
import { getPaymentMethodAction } from "@/lib/billing-payment-method-remediation";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession({
      allowPaymentMethodRemediation: true,
    });
    const response = NextResponse.json({
      action: await getPaymentMethodAction(getDb(), session.userId),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const response = apiError(error, "결제수단 확인 상태를 불러오지 못했습니다.");
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
