import { japanReadsEnabled } from "@/lib/youtube-japan-settings";
import { getDb } from "@/lib/db";
import { NextResponse } from "next/server";
import { catalogReadsEnabled } from "@/lib/youtube-quota";
import { catalogStatus, getCatalogVisibility } from "@/lib/youtube-catalog";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get("type") || "trending";
  const ids = params.get("ids")?.split(",") || [];
  if (ids.length > 200 || ids.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id)))
    return NextResponse.json({}, { status: 400 });
  if (type !== "trending" && type !== "views" && type !== "reusable")
    return NextResponse.json({}, { status: 400 });
  if (!catalogReadsEnabled())
    return NextResponse.json({ catalogEnabled: false });
  try {
    const db = getDb();
    const includeJapan = await japanReadsEnabled(db);
    const now = new Date();
    const [state, visibility] = await Promise.all([
      catalogStatus(db, type, now, includeJapan),
      getCatalogVisibility(ids, db, now, includeJapan),
    ]);
    return NextResponse.json(
      { ...state, visibility },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      { detail: "갱신 상태를 확인하지 못했습니다." },
      { status: 503 },
    );
  }
}
