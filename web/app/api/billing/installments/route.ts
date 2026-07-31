import { NextResponse } from "next/server";
import { z } from "zod";
import { getAddonProduct } from "@/lib/billing";
import { ensureLocalDbReady, getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { getActiveInstallmentOffer } from "@/lib/installments";
import {
  assertLocalManualCheckoutAccess,
  isLocalManualCheckoutEnabled,
  oneTimePaymentMode,
  resolveOneTimePaymentFlow,
} from "@/lib/manual-payment-routing";
import {
  getPricingV2Plan,
  pricingV2EarlyBirdCodes,
  pricingV2PlanCodes,
} from "@/lib/pricing-v2";
import { requireMvpSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  planCode: z.enum(pricingV2PlanCodes).optional(),
  addonCode: z.enum(pricingV2EarlyBirdCodes).optional(),
  issuer: z.string().trim().max(100).optional(),
}).superRefine((value, context) => {
  if (Number(Boolean(value.planCode)) + Number(Boolean(value.addonCode)) !== 1) {
    context.addIssue({
      code: "custom",
      path: ["planCode"],
      message: "패키지 또는 추가시간 상품 코드 하나가 필요합니다.",
    });
  }
});

export async function GET(request: Request) {
  try {
    await ensureLocalDbReady();
    const url = new URL(request.url);
    const query = querySchema.parse({
      planCode: url.searchParams.get("planCode") || undefined,
      addonCode: url.searchParams.get("addonCode") || undefined,
      issuer: url.searchParams.get("issuer") || undefined,
    });
    const db = getDb();
    const plan = query.planCode ? getPricingV2Plan(query.planCode) : null;
    if (plan && plan.kind !== "package") {
      throw new HttpError(409, "월간 구독에는 할부 혜택을 적용할 수 없습니다.");
    }
    const productKind = plan ? "package" as const : "addon" as const;
    const addon = query.addonCode ? await getAddonProduct(db, query.addonCode) : null;
    const productCode = plan?.code || addon?.code;
    const amountKrw = plan?.totalPriceKrw ?? addon?.priceKrw ?? 0;
    const localManualCheckout = isLocalManualCheckoutEnabled()
      ? assertLocalManualCheckoutAccess(request, await requireMvpSession())
      : false;
    const paymentFlow = await resolveOneTimePaymentFlow(db, productKind, {
      localManualCheckout,
    });
    const credentialScope = oneTimePaymentMode(productKind) === "manual"
      ? "manual" as const
      : "default" as const;
    const offer = paymentFlow === "manual_direct"
      ? await getActiveInstallmentOffer(db, {
        amountKrw,
        issuer: query.issuer,
        credentialScope,
        localManualCheckout,
      })
      : {
        credentialScope,
        campaignId: null,
        campaignName: null,
        effectiveFrom: null,
        effectiveTo: null,
        defaultMinAmountKrw: 0,
        notice: "",
        terms: [],
        selectableMonths: [],
        selectableOptions: [],
      };
    return NextResponse.json({
      ...offer,
      productKind,
      productCode,
      amountKrw,
      paymentFlow,
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return apiError(error, "할부 혜택을 불러오지 못했습니다.");
  }
}
