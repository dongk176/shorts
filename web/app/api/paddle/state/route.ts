import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getPaddleState } from "@/lib/paddle/service";
import { paddleJson, paddleError } from "@/lib/paddle/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    return paddleJson({ subscription: await getPaddleState(session.userId) });
  } catch (error) {
    return paddleError(error);
  }
}
