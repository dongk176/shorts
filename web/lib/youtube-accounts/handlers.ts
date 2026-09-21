import "server-only";
import { mediaResponse } from "@/lib/social-publishing/tiktok/media";
import { localVideoResponse } from "@/lib/local-file-video-response";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { accountContext } from "./runtime";
import { uuid } from "./contracts";

function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
async function handle(fn: () => Promise<Response>) {
  try { return privateResponse(await fn()); }
  catch (error) { return privateResponse(apiError(error, "채널 연결을 처리하지 못했습니다.")); }
}
export const connectionsGet = (request: Request) => handle(async () => {
  const { service, actor } = await accountContext(true);
  const shortId = new URL(request.url).searchParams.get("shortId") || undefined;
  const connections = await service.list(actor, shortId);
  const state = await service.disconnectState(actor);
  return NextResponse.json({ connections, disconnectStatus: state.status, reconnectAfterSeconds: state.retryAfterSeconds });
});
export const oauthStart = (request: Request) => handle(async () => {
  assertSameOriginJsonRequest(request);
  const { service, actor, origin } = await accountContext();
  if (request.headers.get("origin") !== origin) throw new HttpError(403, "요청 출처가 올바르지 않습니다.");
  return NextResponse.json({ authorizationUrl: await service.start(actor, await request.json()) });
});
export const oauthCallback = (request: Request) => handle(async () => {
  const { service, actor, origin } = await accountContext();
  const result = await service.callback(actor, new URL(request.url).searchParams);
  const target = new URL(result.returnPath, origin);
  target.searchParams.set("youtubeAccount", result.outcome);
  return NextResponse.redirect(target, 303);
});
export const connectionDelete = (request: Request, context: { params: Promise<{ connectionId: string }> }) => handle(async () => {
  assertSameOriginJsonRequest(request);
  const { service, actor, origin } = await accountContext(true);
  if (request.headers.get("origin") !== origin) throw new HttpError(403, "요청 출처가 올바르지 않습니다.");
  const body = z.object({ confirmAllConnections: z.literal(true) }).strict().parse(await request.json());
  if (!body.confirmAllConnections) throw new HttpError(400, "연결 해제 범위를 확인해 주세요.");
  const result = await service.disconnect(actor, (await context.params).connectionId);
  return NextResponse.json({ ...result, reconnectAfterSeconds: (await service.disconnectState(actor)).retryAfterSeconds });
});
export const eligibilityPost = (request: Request) => handle(async () => {
  assertSameOriginJsonRequest(request);
  const { service, actor, origin } = await accountContext();
  if (request.headers.get("origin") !== origin) throw new HttpError(403, "요청 출처가 올바르지 않습니다.");
  const body = z.object({ shortId: uuid, connectionId: uuid }).strict().parse(await request.json());
  return NextResponse.json(await service.eligibility(actor, body.shortId, body.connectionId));
});
export const uploadsGet = (request: Request) => handle(async () => {
  const { uploads, actor } = await accountContext();
  const shortId = uuid.parse(new URL(request.url).searchParams.get("shortId"));
  return NextResponse.json({ uploads: await uploads.list(actor, shortId), capabilities: uploads.capabilities() });
});
export const uploadsPost = (request: Request) => handle(async () => {
  assertSameOriginJsonRequest(request);
  const { uploads, actor, origin } = await accountContext();
  if (request.headers.get("origin") !== origin) throw new HttpError(403, "요청 출처가 올바르지 않습니다.");
  try { return NextResponse.json({ upload: await uploads.create(actor, await request.json()) }); }
  finally { await uploads.cleanup(); }
});
export const uploadResume = (request: Request, context: { params: Promise<{ uploadId: string }> }) => handle(async () => {
  assertSameOriginJsonRequest(request);
  const { uploads, actor, origin } = await accountContext();
  if (request.headers.get("origin") !== origin) throw new HttpError(403, "요청 출처가 올바르지 않습니다.");
  try { return NextResponse.json({ upload: await uploads.run(actor, (await context.params).uploadId) }); }
  finally { await uploads.cleanup(); }
});

export const mediaGet = (request: Request, context: { params: Promise<{ shortId: string }> }) => handle(async () => {
  const { uploads, actor } = await accountContext();
  const source = await uploads.preview(actor, uuid.parse((await context.params).shortId));
  return source.hosted ? mediaResponse(request, source) : localVideoResponse(request, source.file);
});
