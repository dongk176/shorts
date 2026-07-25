import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { getActiveInstallmentOffer } from "@/lib/installments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  amountKrw: z.coerce.number().int().nonnegative().max(100_000_000),
  issuer: z.string().trim().max(100).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse({
      amountKrw: url.searchParams.get("amountKrw"),
      issuer: url.searchParams.get("issuer") || undefined,
    });
    const offer = await getActiveInstallmentOffer(getDb(), query);
    return NextResponse.json(offer, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return apiError(error, "할부 혜택을 불러오지 못했습니다.");
  }
}
