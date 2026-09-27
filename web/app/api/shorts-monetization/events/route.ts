import { getDb } from "@/lib/db";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { HttpError } from "@/lib/http";
import { batchSchema } from "@/lib/shorts-analytics/schema";
import { saveGuideEvents } from "@/lib/shorts-analytics/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY = 32768;
// A bounded per-instance burst guard; IPs never leave memory or enter analytics.
const bursts = new Map<string, { count: number; until: number }>();
function allowBurst(request: Request) {
  const now = Date.now();
  for (const [key, value] of bursts) if (value.until <= now) bursts.delete(key);
  const key = (
    request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown"
  ).slice(0, 64);
  const entry = bursts.get(key);
  if (entry) return ++entry.count <= 120;
  if (bursts.size >= 5000) return false;
  bursts.set(key, { count: 1, until: now + 60000 });
  return true;
}
async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY)
    throw new HttpError(413, "Body too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new HttpError(413, "Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    assertSameOriginJsonRequest(request);
    if (!allowBurst(request))
      return Response.json(
        { saved: false },
        { status: 429, headers: { ...headers, "Retry-After": "60" } },
      );
    const parsed = batchSchema.safeParse(await boundedBody(request));
    if (!parsed.success)
      return Response.json({ saved: false }, { status: 400, headers });
    const environment =
      process.env.VERCEL_ENV === "preview"
        ? "preview"
        : process.env.NODE_ENV === "production"
          ? "production"
          : "development";
    await saveGuideEvents(getDb(), parsed.data.events, environment);
    return Response.json({ saved: true }, { headers });
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 503;
    // Do not echo DB details, submitted answers, or request headers.
    return Response.json({ saved: false }, { status, headers });
  }
}
