import { NextResponse } from "next/server";
import { z } from "zod";
import { getBillingSummary } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { recordPopularFilterUsage } from "@/lib/popular-filter-usage";
import {
  assertPopularFilterAccess,
  hasDirectPopularFilterAccess,
} from "@/lib/popular-entitlements";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import {
  getPopularVideos,
  PopularSnapshotUnavailableError,
  popularVideoCategories,
  popularVideoTypes,
} from "@/lib/youtube-popular";
import {
  getPopularSearchVideos,
  getReusablePopularVideos,
  PopularSearchSnapshotUnavailableError,
} from "@/lib/youtube-popular-search";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(popularVideoTypes),
  category: z.enum(popularVideoCategories).default("all"),
  reusable: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  longForm: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  korean: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  cursor: z.string().max(500).optional(),
  interactionId: z.string().uuid().optional(),
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
    interactionId: url.searchParams.get("interactionId") || undefined,
  });
  if (!query.success) {
    return NextResponse.json({ detail: "지원하지 않는 인기 영상 필터입니다." }, { status: 400 });
  }
  try {
    const db = getDb();
    let paidFilterUserId: string | null = null;
    const usesPaidFeature = Boolean(query.data.cursor)
      || query.data.type !== "trending"
      || query.data.category !== "all"
      || query.data.reusable
      || query.data.longForm
      || query.data.korean;
    if (usesPaidFeature) {
      const session = await requireAuthenticatedMvpSession();
      const [billing, hasDirectAccess] = await Promise.all([
        getBillingSummary(db, session.userId),
        hasDirectPopularFilterAccess(db, session.userId),
      ]);
      assertPopularFilterAccess(billing, hasDirectAccess);
      paidFilterUserId = session.userId;
    }
    const limit = 48;
    const reusableOnly = query.data.type === "reusable" || query.data.reusable;
    const effectiveType = query.data.type === "reusable" ? "views" : query.data.type;
    let result;
    if (query.data.type === "reusable") {
      try {
        result = await getReusablePopularVideos(
          query.data.category,
          query.data.longForm,
          query.data.korean,
          query.data.cursor,
          limit,
        );
      } catch (error) {
        if (!(error instanceof PopularSearchSnapshotUnavailableError)) throw error;
        result = await getPopularVideos(
          "views",
          query.data.category,
          true,
          query.data.longForm,
          query.data.korean,
          query.data.cursor,
          limit,
        );
      }
    } else if (effectiveType === "views") {
      try {
        result = await getPopularSearchVideos(
          query.data.category,
          reusableOnly,
          query.data.longForm,
          query.data.korean,
          query.data.cursor,
          limit,
        );
      } catch (error) {
        if (!(error instanceof PopularSearchSnapshotUnavailableError)) throw error;
        result = await getPopularVideos(
          effectiveType,
          query.data.category,
          reusableOnly,
          query.data.longForm,
          query.data.korean,
          query.data.cursor,
          limit,
        );
      }
    } else {
      result = await getPopularVideos(
        effectiveType,
        query.data.category,
        reusableOnly,
        query.data.longForm,
        query.data.korean,
        query.data.cursor,
        limit,
      );
    }
    if (paidFilterUserId && !query.data.cursor) {
      await recordPopularFilterUsage(db, {
        interactionId: query.data.interactionId,
        userId: paidFilterUserId,
        type: query.data.type,
        category: query.data.category,
        reusableOnly,
        longFormOnly: query.data.longForm,
        koreanOnly: query.data.korean,
        resultCount: result.items.length,
      });
    }
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof HttpError) return apiError(error);
    const detail = error instanceof PopularSnapshotUnavailableError
      || error instanceof PopularSearchSnapshotUnavailableError
      ? error.message
      : "인기 영상을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return NextResponse.json({ detail }, { status: 503 });
  }
}
