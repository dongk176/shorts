import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { z } from "zod";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
 try {
  const id = z.string().uuid().parse((await params).id);
  const sql = getDb();
  const [visibility] = await sql`select exists(select 1 from shorts_mvp.update_posts where visible=true and ${id}::uuid=any(published_assets)) as public`;
  if (!visibility.public) await requireAdminUser();
  const [asset] = await sql`select image_bytes from shorts_mvp.update_assets where id=${id}::uuid`;
  if (!asset) throw new HttpError(404, "사진을 찾을 수 없습니다.");
  return new Response(new Uint8Array(asset.imageBytes), { headers: { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Cache-Control": visibility.public ? "public, max-age=60, must-revalidate" : "private, no-store" } });
 } catch(e) { return apiError(e); }
}
