import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMvpSession } from "@/lib/session";
import {
  getPopularVideos,
  PopularSnapshotUnavailableError,
  popularVideoCategories,
  popularVideoTypes,
} from "@/lib/youtube-popular";
import {
  getPopularSearchVideos,
  PopularSearchSnapshotUnavailableError,
} from "@/lib/youtube-popular-search";
import { POPULAR_VIDEO_FILTERS_REQUIRE_PRO } from "@/lib/youtube-popular-access";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(popularVideoTypes),
  category: z.enum(popularVideoCategories).default("all"),
  reusable: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  longForm: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  korean: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  cursor: z.string().max(500).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = querySchema.safeParse({
    type: url.searchParams.get("type"),
    category: url.searchParams.get("category") || undefined,
    reusable: url.searchParams.get("reusable") || undefined,
    longForm: url.searchParams.get("longForm") || undefined,
    korean: url.searchParams.get("korean") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  if (!query.success) {
    return NextResponse.json({ detail: "지원하지 않는 인기 영상 필터입니다." }, { status: 400 });
  }
  try {
    const session = await requireMvpSession();
    const hasProAccess = session.selectedPlanCode === "pro";
    const requiresProAccess = Boolean(query.data.cursor) || (
      POPULAR_VIDEO_FILTERS_REQUIRE_PRO
      && (query.data.category !== "all" || query.data.reusable || query.data.longForm)
    );
    if (!hasProAccess && requiresProAccess) {
      const response = NextResponse.json({ detail: "해당 기능은 Pro 전용 기능이에요." }, { status: 403 });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    const limit = hasProAccess ? 48 : 20;
    let result;
    if (query.data.type === "views") {
      try {
        result = await getPopularSearchVideos(
          query.data.category,
          query.data.reusable,
          query.data.longForm,
          query.data.korean,
          query.data.cursor,
          limit,
        );
      } catch (error) {
        if (!(error instanceof PopularSearchSnapshotUnavailableError)) throw error;
        result = await getPopularVideos(
          query.data.type,
          query.data.category,
          query.data.reusable,
          query.data.longForm,
          query.data.korean,
          query.data.cursor,
          limit,
        );
      }
    } else {
      result = await getPopularVideos(
        query.data.type,
        query.data.category,
        query.data.reusable,
        query.data.longForm,
        query.data.korean,
        query.data.cursor,
        limit,
      );
    }
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const detail = error instanceof PopularSnapshotUnavailableError
      || error instanceof PopularSearchSnapshotUnavailableError
      ? error.message
      : "인기 영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return NextResponse.json({ detail }, { status: 503 });
  }
}
