import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RouteContext = { params: Promise<{ accountId: string }> };

const updateSchema = z.object({
  requestId: z.string().uuid(),
  displayName: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
  popularFilterEnabled: z.boolean(),
  serviceAccessUntil: z.string().datetime({ offset: true }).nullable(),
});

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request);
    const [{ accountId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => updateSchema.parse(value)),
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
    const serviceAccessUntil = body.serviceAccessUntil
      ? new Date(body.serviceAccessUntil)
      : null;
    const authAdmin = createSupabaseAdminClient();
    const { error } = await authAdmin.auth.admin.updateUserById(account.authUserId, {
      user_metadata: { full_name: body.displayName },
    });
    if (error) {
      throw new HttpError(
        503,
        "인증 계정 정보를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "MANAGED_AUTH_UPDATE_FAILED",
      );
    }

    await db.begin(async (tx) => {
      const updated = await tx`
        update shorts_mvp.managed_login_accounts managed
        set is_active=${body.isActive},
          popular_filter_enabled=${body.popularFilterEnabled},
          updated_by_user_id=${admin.id}
        where managed.id=${accountId}
        returning app_user_id
      `;
      if (!updated[0]) throw new HttpError(404, "발급 계정을 찾을 수 없습니다.");
      await tx`
        update shorts_mvp.app_users
        set display_name=${body.displayName},
          manual_service_access_until=${serviceAccessUntil},
          updated_at=clock_timestamp()
        where id=${updated[0].appUserId}
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'managed_account.updated','managed_login_account',${accountId},
          ${tx.json({
            loginId: account.loginId,
            displayName: body.displayName,
            isActive: body.isActive,
            popularFilterEnabled: body.popularFilterEnabled,
            serviceAccessUntil: serviceAccessUntil?.toISOString() || null,
            requestId: body.requestId,
          })}
        )
      `;
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "발급 계정 설정을 변경하지 못했습니다.");
  }
}
