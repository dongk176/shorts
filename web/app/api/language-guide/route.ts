import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { requireAuthenticatedMvpSession } from "@/lib/session";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { languageFeatureAllowed, languageTestStatus } from "@/lib/language-test";

export const dynamic = "force-dynamic";
const json = (value: unknown) => NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });

export async function GET() {
  try {
    const session = await requireAuthenticatedMvpSession();
    const db = getDb();
    const allowed = languageFeatureAllowed(await languageTestStatus(db), session.isAdmin === true);
    if (!allowed) return json({ available: false, seen: false });
    const [row] = await db`select status from shorts_mvp.language_guide_views where user_id=${session.userId}`;
    return json({ available: true, seen: Boolean(row), status: row?.status ?? null });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const input = z.object({ userId: z.uuid(), status: z.enum(["dismissed", "completed"]) }).strict().parse(await request.json());
    const session = await requireAuthenticatedMvpSession();
    if (input.userId !== session.userId) throw new HttpError(409, "계정이 변경되었습니다. 페이지를 새로고침해 주세요.");
    const saved = await getDb().begin(async (tx) => {
      await tx`select pg_advisory_xact_lock_shared(hashtextextended('language_test_admission',0))`;
      await tx`select singleton from shorts_mvp.language_test_settings where singleton for share`;
      const [user] = await tx`select is_admin from shorts_mvp.app_users where id=${session.userId}`;
      if (!user || !languageFeatureAllowed(await languageTestStatus(tx), user.isAdmin === true)) return false;
      await tx`insert into shorts_mvp.language_guide_views(user_id,status) values(${session.userId},${input.status})
        on conflict (user_id) do update set status=case
          when language_guide_views.status='completed' then 'completed' else excluded.status end,updated_at=now()`;
      return true;
    });
    return json({ saved });
  } catch (error) { return apiError(error); }
}
