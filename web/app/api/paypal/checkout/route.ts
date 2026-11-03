import { z } from "zod";
import { assertBillingMutationRequest } from "@/lib/billing-request";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { HttpError } from "@/lib/http";
import { preparePayPalCheckout,cancelPayPalCheckout,confirmPayPalCheckout } from "@/lib/paypal/service";
import { paypalJson,paypalError } from "@/lib/paypal/http";
import { oneTimeEnabled } from "@/lib/paypal/one-time-config";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){try{
 assertBillingMutationRequest(request);
 if(oneTimeEnabled())throw new HttpError(409,"Please refresh pricing for one-time checkout.","CHECKOUT_REFRESH_REQUIRED");
 const body=z.object({planCode:z.string().max(40),locale:z.enum(["en","ja"])}).strict().parse(await request.json());
 const session=await requireAuthenticatedMvpSession();if(session.isEnterprise)throw new HttpError(409,"Managed account");
 return paypalJson(await preparePayPalCheckout(session.userId,body.planCode,body.locale));
}catch(e){return paypalError(e);}}
export async function PATCH(request:Request){try{assertBillingMutationRequest(request);const body=z.object({checkoutId:z.string().uuid()}).strict().parse(await request.json());const session=await requireAuthenticatedMvpSession();return paypalJson(await confirmPayPalCheckout(session.userId,body.checkoutId));}catch(e){return paypalError(e);}}
export async function DELETE(request:Request){try{assertBillingMutationRequest(request);const body=z.object({checkoutId:z.string().uuid()}).strict().parse(await request.json());const session=await requireAuthenticatedMvpSession();await cancelPayPalCheckout(session.userId,body.checkoutId);return paypalJson({ok:true});}catch(e){return paypalError(e);}}
