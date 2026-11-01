import { z } from "zod";
import { verifyPayPalWebhook } from "@/lib/paypal/api";
import { processPayPalEvent } from "@/lib/paypal/events";
import { paypalJson,paypalError } from "@/lib/paypal/http";
import { HttpError } from "@/lib/http";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(request:Request){try{
 if(Number(request.headers.get("content-length")??0)>131072)throw new HttpError(413,"Payload too large");
 const raw=await request.text();if(raw.length>131072)throw new HttpError(413,"Payload too large");
 const body=JSON.parse(raw);await verifyPayPalWebhook(request,body);
 const event=z.object({id:z.string().max(100),event_type:z.string().max(100),resource:z.object({id:z.string().optional(),billing_agreement_id:z.string().optional(),sale_id:z.string().optional()}).passthrough()}).passthrough().parse(body);
 await processPayPalEvent(event);return paypalJson({ok:true});
}catch(e){console.error("paypal_webhook_failed",{kind:e instanceof HttpError?e.code:"processing"});return paypalError(e);}}
