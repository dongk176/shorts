import { NextResponse } from "next/server";
import { assertSameOriginJsonRequest } from "@/lib/billing-request";
import { apiError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { removeSavedVideoSchema, saveVideoSchema } from "@/lib/saved-videos";
import { listSavedVideos, removeSavedVideo, saveVideo } from "@/lib/saved-videos-server";

export const dynamic = "force-dynamic";
const options = { readOnly: true, allowPaymentMethodRemediation: true };
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  const response = apiError(error, "저장된 영상을 처리하지 못했습니다.");
  response.headers.set("Cache-Control", headers["Cache-Control"]);
  return response;
}
export async function GET() {
  try {
    const { userId } = await requireAuthenticatedMvpSession(options);
    return NextResponse.json({ items: await listSavedVideos(userId) }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request, "영상 저장 요청");
    const { userId } = await requireAuthenticatedMvpSession(options);
    const { videoId } = saveVideoSchema.parse(await request.json());
    return NextResponse.json(await saveVideo(userId, videoId), { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    assertSameOriginJsonRequest(request, "저장 해제 요청");
    const { userId } = await requireAuthenticatedMvpSession(options);
    const { id } = removeSavedVideoSchema.parse(await request.json());
    await removeSavedVideo(userId, id);
    return NextResponse.json({ removed: true }, { headers });
  } catch (error) { return failure(error); }
}
