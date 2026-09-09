import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { discoveryEnabled } from "@/lib/youtube-quota";
import { backfillCatalogBatch } from "@/lib/youtube-catalog-backfill";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    await requireAdminUser();
    if (
      !discoveryEnabled() ||
      process.env.YOUTUBE_CATALOG_BACKFILL_ENABLED !== "true"
    )
      return NextResponse.json(
        { detail: "데이터 이행이 꺼져 있습니다." },
        { status: 409 },
      );
    return NextResponse.json(await backfillCatalogBatch());
  } catch (error) {
    return apiError(error);
  }
}
