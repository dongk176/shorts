import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { safeNextPath } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  MANAGED_LOGIN_FAILURE_LIMIT,
  MANAGED_LOGIN_NETWORK_FAILURE_LIMIT,
  MANAGED_LOGIN_WINDOW_MINUTES,
  isManagedLoginId,
  managedLoginFingerprint,
  managedLoginNetwork,
  normalizeManagedLoginId,
} from "@/lib/managed-login";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { claimMvpSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  loginId: z.string().trim().min(3).max(32),
  password: z.string().min(1).max(128),
  next: z.string().max(2_048).optional(),
});

const INVALID_LOGIN = new HttpError(
  401,
  "아이디 또는 비밀번호를 확인해 주세요.",
  "MANAGED_LOGIN_FAILED",
);

export async function POST(request: NextRequest) {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> | null = null;
  try {
    assertSameOriginJsonRequest(request);
    const body = signInSchema.parse(await request.json());
    const loginId = normalizeManagedLoginId(body.loginId);
    const identifierHash = managedLoginFingerprint("identifier", loginId);
    const networkHash = managedLoginFingerprint("network", managedLoginNetwork(request));
    const db = getDb();
    const attempts = await db`
      select
        count(*) filter (
          where identifier_hash=${identifierHash} and succeeded=false
        )::integer as identifier_failures,
        count(*) filter (
          where network_hash=${networkHash} and succeeded=false
        )::integer as network_failures
      from shorts_mvp.managed_login_attempts
      where occurred_at > clock_timestamp()
        - (${MANAGED_LOGIN_WINDOW_MINUTES} * interval '1 minute')
    `;
    if (
      Number(attempts[0]?.identifierFailures || 0) >= MANAGED_LOGIN_FAILURE_LIMIT
      || Number(attempts[0]?.networkFailures || 0) >= MANAGED_LOGIN_NETWORK_FAILURE_LIMIT
    ) {
      throw new HttpError(
        429,
        "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.",
        "MANAGED_LOGIN_RATE_LIMIT",
        MANAGED_LOGIN_WINDOW_MINUTES * 60,
      );
    }

    const accountRows = isManagedLoginId(loginId) ? await db`
      select id,auth_email,is_active
      from shorts_mvp.managed_login_accounts
      where login_id=${loginId}
      limit 1
    ` : [];
    const account = accountRows[0];
    const authEmail = account?.isActive
      ? String(account.authEmail)
      : "managed-missing@accounts.easycut.co.kr";

    supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: body.password,
    });
    if (error || !data.user || !account?.isActive) {
      await db`
        insert into shorts_mvp.managed_login_attempts (
          identifier_hash,network_hash,succeeded,failure_code
        ) values (
          ${identifierHash},${networkHash},false,
          ${account && !account.isActive ? "ACCOUNT_DISABLED" : "INVALID_CREDENTIALS"}
        )
      `;
      throw INVALID_LOGIN;
    }

    await claimMvpSession(data.user);
    await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.managed_login_accounts
        set last_login_at=clock_timestamp()
        where id=${account.id} and is_active=true
      `;
      await tx`
        insert into shorts_mvp.managed_login_attempts (
          identifier_hash,network_hash,succeeded
        ) values (${identifierHash},${networkHash},true)
      `;
    });
    const response = NextResponse.json({
      ok: true,
      next: safeNextPath(body.next || null),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (supabase && error !== INVALID_LOGIN) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
    return apiError(error, "로그인하지 못했습니다.");
  }
}
