import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import {
  ADMIN_USAGE_GRANT_MAX_MINUTES,
  ADMIN_USAGE_GRANT_PRODUCT_CODE,
  ADMIN_USAGE_GRANT_VALIDITY_DAYS,
} from "@/lib/admin-usage-grant";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";

const addUsageSchema = z.object({
  requestId: z.string().uuid(),
  userId: z.string().uuid(),
  minutes: z.number().int().min(1).max(ADMIN_USAGE_GRANT_MAX_MINUTES),
  reason: z.string().trim().max(500).optional().default(""),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const [admin, body] = await Promise.all([
      requireAdminUser(),
      request.json().then((value) => addUsageSchema.parse(value)),
    ]);
    const seconds = body.minutes * 60;
    const result = await getDb().begin(async (tx) => {
      await tx`
        select pg_advisory_xact_lock(
          hashtextextended(${`admin-member-usage:${body.requestId}`},0)
        )
      `;
      const duplicateRows = await tx`
        select
          metadata->>'grantId' as grant_id,
          metadata->>'expiresAt' as expires_at
        from shorts_mvp.admin_audit_logs
        where action='member.usage_granted'
          and metadata->>'requestId'=${body.requestId}
        limit 1
      `;
      const duplicate = duplicateRows[0];
      if (duplicate) {
        return {
          grantId: duplicate.grantId || null,
          expiresAt: duplicate.expiresAt || null,
          alreadyProcessed: true,
        };
      }

      const userRows = await tx`
        select id,email,display_name
        from shorts_mvp.app_users
        where id=${body.userId} and withdrawn_at is null
        limit 1
        for update
      `;
      const user = userRows[0];
      if (!user) {
        throw new HttpError(404, "사용량을 지급할 회원을 찾을 수 없습니다.");
      }

      const grantRows = await tx`
        insert into shorts_mvp.usage_grants (
          user_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,
          reserved_seconds,consumed_seconds,valid_from,expires_at,status
        ) values (
          ${user.id},'addon',${ADMIN_USAGE_GRANT_PRODUCT_CODE},
          ${seconds},${seconds},0,0,0,clock_timestamp(),
          clock_timestamp() + ${ADMIN_USAGE_GRANT_VALIDITY_DAYS} * interval '1 day',
          'active'
        )
        returning id,expires_at
      `;
      const grant = grantRows[0];
      const expiresAt = new Date(grant.expiresAt).toISOString();
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'member.usage_granted','app_user',${user.id},
          ${tx.json({
            requestId: body.requestId,
            grantId: grant.id,
            email: user.email || null,
            displayName: user.displayName || null,
            minutes: body.minutes,
            seconds,
            reason: body.reason,
            expiresAt,
          })}
        )
      `;
      return {
        grantId: grant.id,
        expiresAt,
        alreadyProcessed: false,
      };
    });

    return NextResponse.json({
      ok: true,
      minutes: body.minutes,
      ...result,
    });
  } catch (error) {
    return apiError(error, "회원 사용량을 추가하지 못했습니다.");
  }
}
