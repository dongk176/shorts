import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ accountId: string }> };

const resetSchema = z.object({
  requestId: z.string().uuid(),
  temporaryPassword: z.string().min(10).max(128),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request);
    const [{ accountId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => resetSchema.parse(value)),
    ]);
    const db = getDb();
    const accounts = await db`
      select auth_user_id,login_id
      from shorts_mvp.managed_login_accounts
      where id=${accountId}
      limit 1
    `;
    const account = accounts[0];
    if (!account) throw new HttpError(404, "발급 계정을 찾을 수 없습니다.");
    const { error } = await createSupabaseAdminClient().auth.admin.updateUserById(
      account.authUserId,
      { password: body.temporaryPassword },
    );
    if (error) {
      throw new HttpError(
        503,
        "임시 비밀번호를 설정하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "MANAGED_PASSWORD_RESET_FAILED",
      );
    }
    await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.managed_login_accounts
        set last_password_reset_at=clock_timestamp(),updated_by_user_id=${admin.id}
        where id=${accountId}
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'managed_account.password_reset','managed_login_account',
          ${accountId},${tx.json({ loginId: account.loginId, requestId: body.requestId })}
        )
      `;
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "임시 비밀번호를 설정하지 못했습니다.");
  }
}
