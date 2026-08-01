import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ensureLocalDbReady } from "@/lib/db";
import { apiError } from "@/lib/http";
import { loadMvpState } from "@/lib/mvp-state";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  try {
    await ensureLocalDbReady();
    const response = NextResponse.json(
      await loadMvpState(),
      { headers: { "x-request-id": requestId } },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const errorCode = typeof (error as { code?: unknown })?.code === "string"
      ? String((error as { code: string }).code).slice(0, 32)
      : undefined;
    console.error("mvp_state_load_failed", { requestId, errorName, errorCode });
    const response = apiError(error);
    response.headers.set("x-request-id", requestId);
    return response;
  }
}
