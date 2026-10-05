import { z } from "zod";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { authorizeMobile, mobileBody, mobileError, mobileJSON } from "@/lib/admin-mobile-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ eventId: z.uuid(), read: z.literal(true), acknowledged: z.boolean().optional() });
export async function PATCH(request: Request) {
  try {
    const admin = await authorizeMobile(request);
    const body = schema.parse(await mobileBody(request));
    const db = getDb();
    const [event] = await db`select id from shorts_mvp.admin_mobile_events where id=${body.eventId}`;
    if (!event) throw new HttpError(404, "알림을 찾지 못했어요.");
    await db`insert into shorts_mvp.admin_mobile_receipts(event_id,admin_id,read_at,acknowledged_at)
      values(${body.eventId},${admin.id},now(),case when ${body.acknowledged ?? false} then now() else null end)
      on conflict(event_id,admin_id) do update set read_at=coalesce(shorts_mvp.admin_mobile_receipts.read_at,now()),
        acknowledged_at=case when ${body.acknowledged === undefined} then shorts_mvp.admin_mobile_receipts.acknowledged_at
          when ${body.acknowledged ?? false} then now() else null end`;
    return mobileJSON({ ok: true });
  } catch (error) { return mobileError(error); }
}
