import { NextResponse } from "next/server";
import { catalogReadsEnabled } from "@/lib/youtube-quota";
import { catalogStatus } from "@/lib/youtube-catalog";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const type = new URL(request.url).searchParams.get("type") || "trending";
  if (type !== "trending" && type !== "views" && type !== "reusable")
    return NextResponse.json({}, { status: 400 });
  if (!catalogReadsEnabled())
    return NextResponse.json({ catalogEnabled: false });
  try {
    return NextResponse.json(await catalogStatus(undefined, type), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { detail: "갱신 상태를 확인하지 못했습니다." },
      { status: 503 },
    );
  }
}
