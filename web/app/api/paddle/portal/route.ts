import { requireAuthenticatedMvpSession } from "@/lib/session";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { createPaddlePortal } from "@/lib/paddle/service";
import { paddleJson, paddleError } from "@/lib/paddle/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const session = await requireAuthenticatedMvpSession();
    return paddleJson({ url: await createPaddlePortal(session.userId) });
  } catch (error) {
    return paddleError(error);
  }
}
