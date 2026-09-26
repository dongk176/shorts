import { z } from "zod";
import { paddlePlans } from "@/lib/paddle/catalog";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { getRequestLocale } from "@/lib/i18n/server";
import {
  preparePaddleCheckout,
  resumePaddleCheckout,
  cancelPaddleCheckout,
} from "@/lib/paddle/service";
import {
  paddleClientToken,
  paddleEnvironment,
  assertPaddleEnabled,
} from "@/lib/paddle/config";
import { paddleJson, paddleError } from "@/lib/paddle/http";
import { HttpError } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.union([
  z
    .object({
      planCode: z.enum(paddlePlans.map((plan) => plan.code)),
      locale: z.enum(["en", "ja"]),
    })
    .strict(),
  z.object({ transactionId: z.string().regex(/^txn_[a-z0-9]{26}$/) }).strict(),
]);
export async function POST(request: Request) {
  try {
    assertBillingMutationRequest(request);
    assertPaddleEnabled();
    const body = schema.parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    if (session.isEnterprise)
      throw new HttpError(409, "Managed account", "EXISTING_SUBSCRIPTION");
    // Read all configuration before creating a payable transaction.
    const token = paddleClientToken();
    const environment = paddleEnvironment();
    const locale = "locale" in body ? body.locale : await getRequestLocale();
    const transactionId =
      "transactionId" in body
        ? await resumePaddleCheckout(session.userId, body.transactionId)
        : await preparePaddleCheckout(
            session.userId,
            body.planCode,
            locale === "ja" ? "JPY" : "USD",
          );
    return paddleJson({ transactionId, token, environment });
  } catch (error) {
    return paddleError(error);
  }
}
export async function DELETE(request: Request) {
  try {
    assertBillingMutationRequest(request);
    const session = await requireAuthenticatedMvpSession();
    await cancelPaddleCheckout(session.userId);
    return paddleJson({ ok: true });
  } catch (error) {
    return paddleError(error);
  }
}
