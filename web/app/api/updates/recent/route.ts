import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
 const rows = await getDb()`select distinct published->>'date' as date from shorts_mvp.update_posts where visible=true and published is not null and (published->>'date')::date >= (now() at time zone 'Asia/Seoul')::date - 7`;
 return NextResponse.json({ publishedAt: rows.map(r => Date.parse(`${r.date}T00:00:00+09:00`)) }, { headers: { "Cache-Control": "no-store" } });
}
