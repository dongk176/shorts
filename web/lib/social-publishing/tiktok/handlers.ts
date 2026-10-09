import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { mediaResponse } from "./media";
import { tiktokContext, tiktokServices } from "./runtime";
import { uuid } from "./contracts";
import { safeTikTokErrorCode, safeTikTokRequestId } from "./errors";
import { reportTikTokFailure } from "./diagnostics";
import { tiktokConfig } from "./config";

async function handle(fn: () => Promise<Response>) {
  let response: Response;
  try { response = await fn(); }
  catch (error) {
    const known = error instanceof HttpError;
    const failure = reportTikTokFailure("http_request", error, error instanceof z.ZodError ? "TIKTOK_INVALID_POST" : "TIKTOK_UNAVAILABLE");
    response = NextResponse.json({ code: known ? error.code : error instanceof z.ZodError ? "TIKTOK_INVALID_POST" : "TIKTOK_UNAVAILABLE", requestId: failure.requestId }, { status: known ? error.status : error instanceof z.ZodError ? 400 : 503 });
    if (known && error.retryAfterSeconds) response.headers.set("Retry-After", String(error.retryAfterSeconds));
  }
  response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
function sameOrigin(request: Request, origin: string) {
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin") throw new HttpError(403, "Invalid request origin.", "TIKTOK_ORIGIN_INVALID");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "JSON required.", "TIKTOK_INVALID_POST");
}
async function json(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "JSON required.", "TIKTOK_INVALID_POST");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 20_000) { await reader.cancel(); throw new HttpError(413, "Request too large.", "TIKTOK_INVALID_POST"); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { reader.releaseLock(); }
}
export const connectionsGet = (request: Request) => handle(async () => {
  const { service, actor } = await tiktokContext();
  return NextResponse.json(await service.list(actor, new URL(request.url).searchParams.get("shortId") || undefined));
});
export const oauthStart = (request: Request) => handle(async () => {
  const { service, actor, config } = await tiktokContext(); sameOrigin(request, config.origin);
  return NextResponse.json({ authorizationUrl: await service.start(actor, await json(request)) });
});
export const oauthCallback = (request: Request) => handle(async () => {
  try {
    const { service, actor, config } = await tiktokContext();
    const outcome = await service.callback(actor, new URL(request.url).searchParams);
    const url = new URL(outcome.returnPath, config.origin); url.searchParams.set("tiktokAccount", outcome.outcome);
    if (outcome.errorCode) url.searchParams.set("tiktokError", safeTikTokErrorCode(outcome.errorCode));
    const requestId = safeTikTokRequestId(outcome.requestId);
    if (requestId) url.searchParams.set("tiktokRequest", requestId);
    return NextResponse.redirect(url, 303);
  } catch (error) {
    // Even an expired EasyCut session must return to a page, not a raw JSON error.
    // Use the validated configuration origin, never the incoming Host header.
    const url = new URL("/publish/channels", tiktokConfig().origin);
    const failure = reportTikTokFailure("oauth_context", error);
    url.searchParams.set("tiktokAccount", "failed");
    url.searchParams.set("tiktokError", error instanceof HttpError && error.status === 401 ? "TIKTOK_SIGN_IN" : failure.code);
    url.searchParams.set("tiktokRequest", failure.requestId);
    return NextResponse.redirect(url, 303);
  }
});
export const creatorPost = (request: Request) => handle(async () => {
  const { service, actor, config } = await tiktokContext(); sameOrigin(request, config.origin);
  const body = z.object({ connectionId: uuid, shortId: uuid }).strict().parse(await json(request));
  return NextResponse.json(await service.creator(actor, body.connectionId, body.shortId));
});
export const connectionDelete = (request: Request, context: { params: Promise<{ connectionId: string }> }) => handle(async () => {
  const { service, actor, config } = await tiktokContext(); sameOrigin(request, config.origin);
  z.object({ confirm: z.literal(true) }).strict().parse(await json(request));
  return NextResponse.json(await service.disconnect(actor, (await context.params).connectionId));
});
export const postsGet = (request: Request) => handle(async () => {
  const { service, actor } = await tiktokContext();
  return NextResponse.json({ posts: await service.listPosts(actor, uuid.parse(new URL(request.url).searchParams.get("shortId"))) });
});
export const postsPost = (request: Request) => handle(async () => {
  const { service, actor, config } = await tiktokContext(); sameOrigin(request, config.origin);
  return NextResponse.json({ post: await service.create(actor, await json(request)) });
});
export const postCheck = (request: Request, context: { params: Promise<{ postId: string }> }) => handle(async () => {
  const { service, actor, config } = await tiktokContext(); sameOrigin(request, config.origin);
  return NextResponse.json({ post: await service.check(actor, (await context.params).postId) });
});
export const previewGet = (request: Request, context: { params: Promise<{ shortId: string }> }) => handle(async () => {
  const { service, actor } = await tiktokContext();
  return mediaResponse(request, await service.preview(actor, (await context.params).shortId));
});
export const mediaGet = (request: Request, context: { params: Promise<{ capability: string }> }) => handle(async () => {
  const { service } = await tiktokServices();
  return mediaResponse(request, await service.publicMedia((await context.params).capability));
});
