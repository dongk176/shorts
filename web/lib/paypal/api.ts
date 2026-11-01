import "server-only";
import { HttpError } from "@/lib/http";
import { paypalPlan } from "./catalog";
import { logPayPalResponseFailure, logPayPalTransportFailure } from "./diagnostics";
async function providerFetch(host: string, path: string, init: RequestInit) {
  let response: Response;
  try { response = await fetch(host + path, init); }
  catch (error) { logPayPalTransportFailure(path, error); throw error; }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    logPayPalResponseFailure(path, response.status, body, response.headers.get("paypal-debug-id"));
    throw new HttpError(503, "PayPal request could not be confirmed.", "PAYPAL_UNCONFIRMED");
  }
  return response;
}
export function paypalEnabled() { return process.env.PAYPAL_ENABLED === "true"; }
export function paypalEnvironment() {
  const env = process.env.PAYPAL_ENVIRONMENT;
  if (env !== "live" && env !== "sandbox") throw new HttpError(503,"PayPal is unavailable.");
  return env;
}
export function paypalPlanId(code: string) {
  paypalPlan(code);
  const id = process.env[`PAYPAL_PLAN_${code.toUpperCase()}`];
  if (!id || !/^P-[A-Z0-9]{20,32}$/.test(id)) throw new HttpError(503,"PayPal is unavailable.");
  return id;
}
let cached: { key: string; token: string; until: number } | null = null;
export async function paypalRequest<T>(path: string, body?: unknown, options: { method?: "POST" | "GET"; requestId?: string } = {}): Promise<T> {
  if (!/^\/v1\/(billing\/(plans|subscriptions)|payments\/(sale|refund)|notifications\/verify-webhook-signature)(\/[A-Za-z0-9-]+)*(\?[^#]*)?$/.test(path)) throw Error("Invalid PayPal path");
  const host=paypalEnvironment()==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
  const client=process.env.PAYPAL_CLIENT_ID, secret=process.env.PAYPAL_CLIENT_SECRET;
  if (!client || !secret) throw new HttpError(503,"PayPal is unavailable.");
  const key=host+client;
  if (!cached || cached.key!==key || cached.until<Date.now()) {
    const r=await providerFetch(host,"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+Buffer.from(client+":"+secret).toString("base64"),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials",cache:"no-store",signal:AbortSignal.timeout(12000)});
    if(!r.ok) throw new HttpError(503,"PayPal is unavailable.");
    const token=await r.json();
    if(typeof token.access_token!=="string" || !(token.expires_in>60))throw Error("Invalid PayPal authentication");
    cached={key,token:token.access_token,until:Date.now()+Math.min(token.expires_in-60,3000)*1000};
  }
  const r=await providerFetch(host,path,{method:options.method??(body===undefined?"GET":"POST"),headers:{Authorization:"Bearer "+cached.token,"Content-Type":"application/json",Prefer:"return=representation",...(options.requestId?{"PayPal-Request-Id":options.requestId}:{} )},body:body===undefined?undefined:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!r.ok) throw new HttpError(503,"PayPal request could not be confirmed.","PAYPAL_UNCONFIRMED");
  return r.status===204 ? undefined as T : await r.json() as T;
}
export async function verifyPayPalWebhook(request: Request, event: unknown) {
  const webhookId=process.env.PAYPAL_WEBHOOK_ID;
  const names=["paypal-auth-algo","paypal-cert-url","paypal-transmission-id","paypal-transmission-sig","paypal-transmission-time"];
  const headers=names.map(n=>request.headers.get(n));
  if(!webhookId || headers.some(v=>!v))throw new HttpError(401,"Invalid webhook");
  const r=await paypalRequest<{verification_status:string}>("/v1/notifications/verify-webhook-signature",{auth_algo:headers[0],cert_url:headers[1],transmission_id:headers[2],transmission_sig:headers[3],transmission_time:headers[4],webhook_id:webhookId,webhook_event:event});
  if(r.verification_status!=="SUCCESS")throw new HttpError(401,"Invalid webhook");
}
