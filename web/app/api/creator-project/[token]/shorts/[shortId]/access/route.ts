import { NextResponse } from "next/server";
import { getShortPlaybackAccess } from "@/lib/aws";
import { findCreatorShareMedia } from "@/lib/creator-project-shares";
import { apiError, HttpError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  context: { params: Promise<{ token: string; shortId: string }> },
) {
  try {
    const { token, shortId } = await context.params;
    const media = await findCreatorShareMedia(token, shortId);
    if (!media) throw new HttpError(404, "재생할 영상을 찾을 수 없습니다.");
    const access = await getShortPlaybackAccess({
      outputKey: media.outputKey,
      thumbnailKey: media.thumbnailKey,
      expiresAt: new Date(Math.min(
        media.mediaExpiresAt.getTime(),
        media.shareExpiresAt.getTime(),
      )),
    });
    const response = NextResponse.json({
      ...access,
      renderVersion: media.renderVersion,
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    return apiError(error);
  }
}
