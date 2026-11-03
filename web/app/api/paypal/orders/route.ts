import { z } from "zod";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { HttpError } from "@/lib/http";
import { prepareOneTimeOrder, confirmOneTimeOrder, cancelOneTimeOrder } from "@/lib/paypal/one-time";
import { paypalJson, paypalError } from "@/lib/paypal/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const identity = z.object({ checkoutId: z.string().uuid() }).strict();
export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const body = z.object({ planCode: z.string().max(40), locale: z.enum(["en", "ja"]), consent: z.literal(true) }).strict().parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    if (session.isEnterprise) throw new HttpError(409, "Managed account");
    return paypalJson(await prepareOneTimeOrder(session.userId, body.planCode, body.locale));
  } catch (e) { return paypalError(e); }
}
export async function PATCH(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const body = identity.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    return paypalJson(await confirmOneTimeOrder(session.userId, body.checkoutId));
  } catch (e) { return paypalError(e); }
}
export async function DELETE(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const body = identity.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    return paypalJson(await cancelOneTimeOrder(session.userId, body.checkoutId));
  } catch (e) { return paypalError(e); }
}
