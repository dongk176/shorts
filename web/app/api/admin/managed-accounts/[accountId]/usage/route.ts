import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { MANAGED_ACCOUNT_PRODUCT_CODE } from "@/lib/managed-login";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

type RouteContext = { params: Promise<{ accountId: string }> };

const addUsageSchema = z.object({
  requestId: z.string().uuid(),
  minutes: z.number().int().min(1).max(100_000),
  validUntil: z.string().datetime({ offset: true }),
});

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    assertSameOriginJsonRequest(request);
    const [{ accountId }, admin, body] = await Promise.all([
      params,
      requireAdminUser(),
      request.json().then((value) => addUsageSchema.parse(value)),
    ]);
    const validUntil = new Date(body.validUntil);
    if (validUntil.getTime() <= Date.now()) {
      throw new HttpError(400, "사용량 만료일은 현재보다 이후여야 합니다.");
    }
    const seconds = body.minutes * 60;
    const result = await getDb().begin(async (tx) => {
      const duplicate = await tx`
        select id
        from shorts_mvp.admin_audit_logs
        where action='managed_account.usage_added'
          and metadata->>'requestId'=${body.requestId}
        limit 1
      `;
      if (duplicate[0]) return { alreadyProcessed: true };
      const accounts = await tx`
        select managed.app_user_id,managed.login_id
        from shorts_mvp.managed_login_accounts managed
        where managed.id=${accountId}
        limit 1
        for update
      `;
      const account = accounts[0];
      if (!account) throw new HttpError(404, "발급 계정을 찾을 수 없습니다.");
      await tx`
        update shorts_mvp.app_users
        set manual_service_access_until=greatest(
          coalesce(manual_service_access_until,${validUntil}),
          ${validUntil}
        ),updated_at=clock_timestamp()
        where id=${account.appUserId}
      `;
      await tx`
        insert into shorts_mvp.usage_grants (
          user_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,
          valid_from,expires_at,status
        ) values (
          ${account.appUserId},'addon',${MANAGED_ACCOUNT_PRODUCT_CODE},${seconds},
          ${seconds},0,clock_timestamp(),${validUntil},'active'
        )
      `;
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'managed_account.usage_added','managed_login_account',
          ${accountId},
          ${tx.json({
            requestId: body.requestId,
            loginId: account.loginId,
            minutes: body.minutes,
            validUntil: validUntil.toISOString(),
          })}
        )
      `;
      return { alreadyProcessed: false };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error, "사용량을 추가하지 못했습니다.");
  }
}
