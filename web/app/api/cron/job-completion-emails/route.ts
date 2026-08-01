import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  createResendJobCompletionEmailSender,
  jobCompletionEmailConfigured,
  processJobCompletionEmailNotifications,
} from "@/lib/job-completion-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const secretBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return Boolean(
    secret
    && provided
    && secretBytes.length === providedBytes.length
    && timingSafeEqual(secretBytes, providedBytes),
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  if (!jobCompletionEmailConfigured()) {
    return NextResponse.json(
      { detail: "Job completion email is not configured" },
      { status: 503 },
    );
  }

  try {
    const result = await processJobCompletionEmailNotifications(
      getDb(),
      createResendJobCompletionEmailSender(),
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("job_completion_email_cron_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { detail: "Job completion email processing failed" },
      { status: 500 },
    );
  }
}
