import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { mediaResponse } from "../tiktok/media";
import { metaContext, metaServices } from "./runtime";
import { verifyMetaDeletionRequest } from "./signed-request";
import { hash } from "./vault";
import { uuid, platformSchema } from "./contracts";

type Route = { params: Promise<{ platform: string; connectionId?: string; postId?: string; shortId?: string; capability?: string }> };
async function handle(fn: () => Promise<Response>) {
  let response: Response;
  try { response = await fn(); }
  catch (error) {
    const known = error instanceof HttpError;
    response = NextResponse.json({ code: known ? error.code.startsWith("TIKTOK_") ? "META_MEDIA_UNAVAILABLE" : error.code : error instanceof z.ZodError ? "META_INVALID_POST" : "META_UNAVAILABLE" }, { status: known ? error.status : error instanceof z.ZodError ? 400 : 503 });
    if (known && error.retryAfterSeconds) response.headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
function sameOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") throw new HttpError(403, "Invalid request origin.", "META_ORIGIN_INVALID");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "JSON required.", "META_INVALID_POST");
}
async function json(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "JSON required.", "META_INVALID_POST");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 20_000) { await reader.cancel(); throw new HttpError(413, "Request too large.", "META_INVALID_POST"); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
export const connectionsGet = (request: Request, context: Route) => handle(async () => {
  const { service, actor } = await metaContext(platformSchema.parse((await context.params).platform));
  return NextResponse.json(await service.list(actor, new URL(request.url).searchParams.get("shortId") || ""));
});
export const oauthStart = (request: Request, context: Route) => handle(async () => {
  const { service, actor, config } = await metaContext(platformSchema.parse((await context.params).platform)); sameOrigin(request, config.origin);
  return NextResponse.json({ authorizationUrl: await service.start(actor, await json(request)) });
});
export const oauthCallback = (request: Request, context: Route) => handle(async () => {
  const { service, actor, config } = await metaContext(platformSchema.parse((await context.params).platform));
  const outcome = await service.callback(actor, new URL(request.url).searchParams);
  const url = new URL(outcome.returnPath, config.origin); url.searchParams.set(`${config.platform}Account`, outcome.outcome);
  return NextResponse.redirect(url, 303);
});
export const connectionDelete = (request: Request, context: Route) => handle(async () => {
  const { service, actor, config } = await metaContext(platformSchema.parse((await context.params).platform)); sameOrigin(request, config.origin);
  z.object({ confirm: z.literal(true) }).strict().parse(await json(request));
  return NextResponse.json(await service.disconnect(actor, (await context.params).connectionId || ""));
});
export const postsGet = (request: Request, context: Route) => handle(async () => {
  const { service, actor } = await metaContext(platformSchema.parse((await context.params).platform));
  return NextResponse.json({ posts: await service.listPosts(actor, uuid.parse(new URL(request.url).searchParams.get("shortId"))) });
});
export const postsPost = (request: Request, context: Route) => handle(async () => {
  const { service, actor, config } = await metaContext(platformSchema.parse((await context.params).platform)); sameOrigin(request, config.origin);
  return NextResponse.json({ post: await service.create(actor, await json(request)) });
});
export const postCheck = (request: Request, context: Route) => handle(async () => {
  const { service, actor, config } = await metaContext(platformSchema.parse((await context.params).platform)); sameOrigin(request, config.origin);
  return NextResponse.json({ post: await service.check(actor, (await context.params).postId || "") });
});
export const previewGet = (request: Request, context: Route) => handle(async () => {
  const { service, actor } = await metaContext(platformSchema.parse((await context.params).platform));
  return mediaResponse(request, await service.preview(actor, (await context.params).shortId || ""));
});
export const mediaGet = (request: Request, context: Route) => handle(async () => {
  const { service } = metaServices(platformSchema.parse((await context.params).platform));
  return mediaResponse(request, await service.publicMedia((await context.params).capability || ""));
});

export const deauthorizePost = (request: Request, context: Route) => handle(async () => {
  const { config, store } = metaServices(platformSchema.parse((await context.params).platform));
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) throw new HttpError(415, "Invalid request.", "META_INVALID_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Invalid request.", "META_INVALID_REQUEST");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 20_000) { await reader.cancel(); throw new HttpError(413, "Invalid request.", "META_INVALID_REQUEST"); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  const signed = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("signed_request") || "";
  let identity;
  try { identity = verifyMetaDeletionRequest(signed, config.clientSecret); }
  catch { throw new HttpError(403, "Invalid signature.", "META_INVALID_REQUEST"); }
  // Old events cannot remove a newly reconnected account. Recent receipts fence retries.
  if (identity.issuedAt < Date.now()/1000 - 90*86400) throw new HttpError(400, "Expired request.", "META_INVALID_REQUEST");
  await store.deauthorized(identity.userId, identity.issuedAt, hash(config.appKey+":"+signed));
  return NextResponse.json({ success: true });
});
