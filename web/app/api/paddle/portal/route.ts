import { z } from "zod";
import { cancellationFeedbackSchema } from "@/lib/subscription-cancellation";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { cancelPaddleSubscription, createPaddlePortal } from "@/lib/paddle/service";
import { paddleJson, paddleError } from "@/lib/paddle/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const session = await requireAuthenticatedMvpSession();
    const body = z.union([
      z.object({action:z.literal("cancel"),feedback:cancellationFeedbackSchema}).strict(),
      z.object({}).strict(),
    ]).parse(await request.json());
    if ("action" in body) return paddleJson(await cancelPaddleSubscription(session.userId, body.feedback));
    return paddleJson({ url: await createPaddlePortal(session.userId) });
  } catch (error) {
    return paddleError(error);
  }
}
