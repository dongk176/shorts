import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { chargeEnterpriseBillingItem } from "@/lib/enterprise-billing-charge";
import { requireEnterprisePaymentOwner } from "@/lib/enterprise-payment-auth";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type RouteContext = { params: Promise<{ token: string; itemId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request, "기업 등록카드 결제");
    const { token, itemId } = z.object({
      token: z.string().uuid(),
      itemId: z.string().uuid(),
    }).parse(await params);
    const { session } = await requireEnterprisePaymentOwner(token);
    const result = await chargeEnterpriseBillingItem({
      token,
      itemId,
      appUserId: session.userId,
    });
    return NextResponse.json(result, {
      status: result.state === "manual_review" ? 202 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "등록된 카드로 결제하지 못했습니다.");
  }
}
