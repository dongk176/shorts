import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { creatorError, requireCreatorAccount } from "@/lib/creator-support-server";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const account = await requireCreatorAccount();
    const id = z.uuid().parse((await params).id);
    const db = getDb();
    const [owner] = await db`select user_id from shorts_mvp.creator_support_assets where id=${id}`;
    if (!owner) throw new HttpError(404, "이미지를 찾을 수 없습니다.");
    if (owner.userId !== account.id) await requireAdminUser();
    const [row] = await db`
      select a.image_bytes from shorts_mvp.creator_support_assets a
      where a.id=${id} and not exists (
        select 1 from shorts_mvp.creator_support_enrollments e
        join shorts_mvp.app_users u on u.id=e.user_id
        where e.asset_id=a.id and (e.terminated_at is not null or e.promotion_ends_at<=clock_timestamp() or u.withdrawn_at is not null)
      )
    `;
    if (!row) throw new HttpError(404, "이용 기간이 종료된 이미지입니다.");
    return new Response(new Uint8Array(row.imageBytes), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" },
    });
  } catch (error) { return creatorError(error); }
}
