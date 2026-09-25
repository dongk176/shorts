import { z } from "zod";
import { verifyPaddleSignature } from "@/lib/paddle/signature";
import { processPaddleEvent } from "@/lib/paddle/service";
import { paddleJson } from "@/lib/paddle/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const eventSchema = z.object({
  event_id: z.string().regex(/^evt_[a-z0-9]{26}$/),
  event_type: z.string(),
  occurred_at: z.iso.datetime({ offset: true }),
  data: z.object({ id: z.string() }),
});
const types = new Set([
  "transaction.completed",
  "transaction.canceled",
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.canceled",
  "subscription.paused",
  "subscription.resumed",
  "subscription.past_due",
  "adjustment.created",
  "adjustment.updated",
]);
export async function POST(request: Request) {
  // Keep accepting verified events when new checkout creation is disabled.
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return paddleJson({ code: "NOT_CONFIGURED" }, 503);
  if (Number(request.headers.get("content-length") || 0) > 1048576)
    return paddleJson({}, 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1048576) return paddleJson({}, 413);
  if (
    !verifyPaddleSignature(raw, request.headers.get("paddle-signature"), secret)
  )
    return paddleJson({ code: "INVALID_SIGNATURE" }, 401);
  let event;
  try {
    event = eventSchema.parse(JSON.parse(raw));
  } catch {
    return paddleJson({ code: "INVALID_EVENT" }, 400);
  }
  if (!types.has(event.event_type)) return paddleJson({ ignored: true });
  const prefix = event.event_type.startsWith("transaction.")
    ? "txn"
    : event.event_type.startsWith("subscription.")
      ? "sub"
      : "adj";
  if (!new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(event.data.id))
    return paddleJson({ code: "INVALID_EVENT" }, 400);
  try {
    await processPaddleEvent(event);
    return paddleJson({ ok: true });
  } catch {
    console.error("paddle_webhook_processing_failed", {
      eventId: event.event_id,
      eventType: event.event_type,
    });
    return paddleJson({ code: "RETRY_REQUIRED" }, 503);
  }
}
