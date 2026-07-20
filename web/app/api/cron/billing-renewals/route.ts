import { NextResponse } from "next/server";
import { processBillingRenewals } from "@/lib/billing-renewals";
import { getDb } from "@/lib/db";
import { safeSecretEqual } from "@/lib/toss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !provided || !safeSecretEqual(secret, provided)) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await processBillingRenewals(getDb()));
  } catch (error) {
    console.error("billing_renewal_cron_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ detail: "Billing renewal failed" }, { status: 500 });
  }
}
