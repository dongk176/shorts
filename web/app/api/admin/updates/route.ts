import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { readCreatorJson } from "@/lib/creator-support-upload";
import { apiError, HttpError } from "@/lib/http";
import { listAdminUpdates, saveUpdate } from "@/lib/update-store";
import { updateDraftSchema } from "@/lib/update-content";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
export async function GET() { try { await requireAdminUser(); return NextResponse.json(await listAdminUpdates(), { headers: { "Cache-Control": "private, no-store" } }); } catch (e) { return apiError(e); } }
export async function POST(request: Request) {
 try {
  assertSameOriginJsonRequest(request); const admin = await requireAdminUser();
  const input = z.object({ id: z.string().uuid(), version: z.number().int().min(0), action: z.enum(["save", "publish", "hide", "translate"]), draft: updateDraftSchema }).parse(await readCreatorJson(request, 1_500_000));
  return NextResponse.json(await saveUpdate(input, admin.id), { headers: { "Cache-Control": "private, no-store" } });
 } catch (e) { if ((e as { code?: string }).code === "23505") return apiError(new HttpError(409, "이미 사용 중인 글 주소입니다. 다른 주소로 바꿔 주세요.")); return apiError(e); }
}
