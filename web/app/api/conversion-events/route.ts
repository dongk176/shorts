import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { conversionEventSchema } from "@/lib/conversion-events";
import { saveConversionEvent } from "@/lib/conversion-events-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY = 1024;
const bursts = new Map<string, { count: number; until: number }>();
function allowBurst(userId: string) {
  const now = Date.now();
  for (const [key, value] of bursts) if (value.until <= now) bursts.delete(key);
  const current = bursts.get(userId);
  if (current) return ++current.count <= 60;
  if (bursts.size >= 5000) return false;
  bursts.set(userId, { count: 1, until: now + 60_000 });
  return true;
}
async function readBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new HttpError(413, "Body too large");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw new HttpError(413, "Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    assertSameOriginJsonRequest(request);
    const parsed = conversionEventSchema.safeParse(await readBody(request));
    if (!parsed.success) return Response.json({ saved: false }, { status: 400, headers });
    const session = await requireAuthenticatedMvpSession({ readOnly: true, createIfMissing: false, allowPaymentMethodRemediation: true });
    if (!allowBurst(session.userId)) return Response.json({ saved: false }, { status: 429, headers });
    await saveConversionEvent(getDb(), session.userId, parsed.data, request.headers.get("x-vercel-ip-country"));
    return Response.json({ saved: true }, { headers });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : 503;
    if (status === 503) console.warn("conversion_event_save_failed", { event: "client_event" });
    return Response.json({ saved: false }, { status, headers });
  }
}
