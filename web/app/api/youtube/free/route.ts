import { NextResponse } from "next/server";
import { z } from "zod";
import { FreeSnapshotUnavailableError, getFreeVideos } from "@/lib/youtube-free";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  korean: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  cursor: z.string().max(500).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = querySchema.safeParse({
    korean: url.searchParams.get("korean") || undefined,
    cursor: url.searchParams.get("cursor") || undefined,
  });
  if (!query.success) {
    return NextResponse.json({ detail: "무료 소재 페이지 정보가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    const result = await getFreeVideos(query.data.korean, query.data.cursor);
    const response = NextResponse.json(result);
    response.headers.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
    return response;
  } catch (error) {
    const detail = error instanceof FreeSnapshotUnavailableError
      ? error.message
      : "오늘의 무료 소재를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    return NextResponse.json({ detail }, { status: 503 });
  }
}
