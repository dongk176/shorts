import { assertBillingMutationRequest } from "@/lib/billing-request";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { cancelPayPalSubscription,getPayPalState } from "@/lib/paypal/service";
import { paypalJson,paypalError } from "@/lib/paypal/http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){try{const s=await requireAuthenticatedMvpSession();return paypalJson(await getPayPalState(s.userId));}catch(e){return paypalError(e);}}
export async function DELETE(request:Request){try{assertBillingMutationRequest(request);const s=await requireAuthenticatedMvpSession();await cancelPayPalSubscription(s.userId);return paypalJson(await getPayPalState(s.userId));}catch(e){return paypalError(e);}}
