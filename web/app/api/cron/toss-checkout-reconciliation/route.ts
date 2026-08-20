import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processTossInitialCheckoutReconciliations } from "@/lib/toss-checkout";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeSecretEqual(expected: string, actual: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!secret || !provided || !safeSecretEqual(secret, provided)) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processTossInitialCheckoutReconciliations(getDb());
    return NextResponse.json(result);
  } catch (error) {
    console.error("toss_initial_checkout_reconciliation_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ detail: "Reconciliation failed" }, { status: 500 });
  }
}
