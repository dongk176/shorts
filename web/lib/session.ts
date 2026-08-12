import { createHash, randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { assertPaymentMethodRemediationAccess } from "@/lib/billing-payment-method-remediation";
import { HttpError } from "@/lib/http";
import { issueLoginWelcomeGrantIfEligible } from "@/lib/onboarding-welcome-grant";
import { REFERRAL_COOKIE } from "@/lib/referral-policy";
import { referralTokenHash } from "@/lib/referral-security";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export const MVP_SESSION_COOKIE = "shorts_mvp_session";

export type AuthProfile = {
  id: string;
  email: string | null;
  loginId?: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type MvpSession = {
  id: string;
  selectedPlanCode: string;
  userId: string | null;
  user: AuthProfile | null;
};

type SessionAccessOptions = {
  enforcePaymentMethodRemediation?: boolean;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function profileValue(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

export function authProfile(user: User): AuthProfile {
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    email: profileValue(user.email, 320),
    loginId: profileValue(user.app_metadata?.login_id, 32),
    displayName: profileValue(metadata.full_name || metadata.name, 200),
    avatarUrl: profileValue(metadata.avatar_url || metadata.picture, 2048),
  };
}

function setSessionCookie(cookieStore: Awaited<ReturnType<typeof cookies>>, token: string) {
  cookieStore.set(MVP_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

type StoredSession = {
  id: string;
  selectedPlanCode: string;
  userId: string | null;
  lastSeenAt: Date;
};

async function findStoredSession(
  db: ReturnType<typeof getDb>,
  token: string | undefined,
): Promise<StoredSession | undefined> {
  if (!token) return undefined;
  const rows = await db`
    select id, selected_plan_code, user_id, last_seen_at
    from shorts_mvp.mvp_sessions
    where token_hash=${hashToken(token)}
    limit 1
  `;
  const existing = rows[0] as StoredSession | undefined;
  if (existing?.lastSeenAt instanceof Date && existing.lastSeenAt.getTime() < Date.now() - 5 * 60 * 1000) {
    await db`
      update shorts_mvp.mvp_sessions
      set last_seen_at=now()
      where id=${existing.id} and last_seen_at < now() - interval '5 minutes'
    `;
  }
  return existing;
}

async function createStoredSession(
  db: Sql | TransactionSql,
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  userId: string | null,
  selectedPlanCode = "free",
): Promise<StoredSession> {
  const token = randomBytes(32).toString("base64url");
  const rows = await db`
    insert into shorts_mvp.mvp_sessions (token_hash, selected_plan_code, user_id)
    values (${hashToken(token)}, ${selectedPlanCode}, ${userId})
    returning id, selected_plan_code, user_id, last_seen_at
  `;
  setSessionCookie(cookieStore, token);
  return rows[0] as StoredSession;
}

export async function requireMvpSession(
  authenticatedUser?: User | null,
  options: SessionAccessOptions = {},
): Promise<MvpSession> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MVP_SESSION_COOKIE)?.value;
  const db = getDb();
  const existing = await findStoredSession(db, token);
  const authUser = authenticatedUser === undefined ? await getAuthenticatedUser() : authenticatedUser;
  if (!authUser) {
    if (existing && !existing.userId) {
      return {
        id: existing.id,
        selectedPlanCode: existing.selectedPlanCode,
        userId: null,
        user: null,
      };
    }
    const created = await createStoredSession(db, cookieStore, null);
    return { id: created.id, selectedPlanCode: created.selectedPlanCode, userId: null, user: null };
  }

  const profile = authProfile(authUser);
  const appUsers = await db`
    select u.id, coalesce(s.plan_code,'free') as selected_plan_code
    from shorts_mvp.app_users u
    left join lateral (
      select s.plan_code from shorts_mvp.user_subscriptions s
      join shorts_mvp.plans p on p.code=s.plan_code
      where s.user_id=u.id and s.status in ('trialing','active','past_due')
      order by p.max_active_jobs desc,p.retention_days desc,s.created_at desc limit 1
    ) s on true
    where u.auth_user_id=${authUser.id}
    limit 1
  `;
  const appUser = appUsers[0] as { id: string; selectedPlanCode: string } | undefined;
  if (!appUser) throw new Error("로그인 계정 연결이 완료되지 않았습니다. 다시 로그인해 주세요.");

  const activeSession = existing?.userId === appUser.id
    ? existing
    : await createStoredSession(db, cookieStore, appUser.id, appUser.selectedPlanCode);

  const result = {
    id: activeSession.id,
    selectedPlanCode: appUser.selectedPlanCode,
    userId: appUser.id,
    user: profile,
  };
  if (options.enforcePaymentMethodRemediation) {
    await assertPaymentMethodRemediationAccess(db, appUser.id);
  }
  return result;
}

export async function requireAuthenticatedMvpSession(options: {
  allowPaymentMethodRemediation?: boolean;
} = {}): Promise<MvpSession & { userId: string }> {
  const session = await requireMvpSession(undefined, {
    enforcePaymentMethodRemediation: !options.allowPaymentMethodRemediation,
  });
  if (!session.userId) throw new HttpError(401, "로그인이 필요합니다.");
  return session as MvpSession & { userId: string };
}

export async function claimMvpSession(authenticatedUser: User): Promise<MvpSession> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MVP_SESSION_COOKIE)?.value;
  const referralToken = cookieStore.get(REFERRAL_COOKIE)?.value;
  const db = getDb();
  const existing = await findStoredSession(db, token);
  const profile = authProfile(authenticatedUser);
  const preferredPlan = "free";
  const provider = authenticatedUser.app_metadata?.login_type === "managed"
    ? "managed_password"
    : profileValue(authenticatedUser.app_metadata?.provider, 100) || "google";
  const claimed = await db.begin(async (tx) => {
    const insertedRows = await tx`
      insert into shorts_mvp.app_users (
        auth_user_id, email, display_name, avatar_url, provider,
        selected_plan_code, last_sign_in_at
      ) values (
        ${authenticatedUser.id}, ${profile.email}, ${profile.displayName}, ${profile.avatarUrl},
        ${provider}, ${preferredPlan}, ${authenticatedUser.last_sign_in_at || new Date().toISOString()}
      )
      on conflict (auth_user_id) do nothing
      returning id, selected_plan_code
    `;
    const newlyCreated = Boolean(insertedRows[0]);
    const appUserRows = newlyCreated ? insertedRows : await tx`
      update shorts_mvp.app_users
      set email=${profile.email},display_name=${profile.displayName},avatar_url=${profile.avatarUrl},
        provider=${provider},
        last_sign_in_at=${authenticatedUser.last_sign_in_at || new Date().toISOString()}
      where auth_user_id=${authenticatedUser.id}
      returning id,selected_plan_code
    `;
    const insertedUser = appUserRows[0] as { id: string; selectedPlanCode: string } | undefined;
    if (!insertedUser) {
      throw new Error("로그인 계정 연결이 완료되지 않았습니다. 다시 로그인해 주세요.");
    }

    if (newlyCreated && referralToken && authenticatedUser.created_at) {
      const visitorRows = await tx`
        select v.id,v.partner_id
        from shorts_mvp.referral_visitors v
        join shorts_mvp.referral_partners p on p.id=v.partner_id
        where v.token_hash=${referralTokenHash(referralToken)}
          and v.expires_at>now()
          and v.first_seen_at<=${authenticatedUser.created_at}
          and p.status='active'
        limit 1
        for update of v
      `;
      const visitor = visitorRows[0];
      if (visitor) {
        const attributed = await tx`
          update shorts_mvp.app_users
          set referral_partner_id=${visitor.partnerId},
            referral_visitor_id=${visitor.id},referral_attributed_at=now()
          where id=${insertedUser.id} and referral_partner_id is null
          returning id
        `;
        if (attributed[0]) {
          await tx`
            insert into shorts_mvp.referral_attribution_audits (
              user_id,new_partner_id,visitor_id,reason
            ) values (
              ${insertedUser.id},${visitor.partnerId},${visitor.id},'신규 회원 자동 귀속'
            )
          `;
        }
      }
    }

    const entitlementRows = await tx`
      select coalesce((
        select s.plan_code from shorts_mvp.user_subscriptions s
        join shorts_mvp.plans p on p.code=s.plan_code
        where s.user_id=${insertedUser.id} and s.status in ('trialing','active','past_due')
        order by p.max_active_jobs desc,p.retention_days desc,s.created_at desc limit 1
      ),'free') as selected_plan_code
    `;
    const appUser = {
      id: insertedUser.id,
      selectedPlanCode: String(entitlementRows[0]?.selectedPlanCode || "free"),
    };
    const activeSession = !existing || (existing.userId && existing.userId !== appUser.id)
      ? await createStoredSession(tx, cookieStore, appUser.id, appUser.selectedPlanCode)
      : existing;

    await tx`
      update shorts_mvp.mvp_sessions
      set user_id=${appUser.id}, selected_plan_code=${appUser.selectedPlanCode}
      where id=${activeSession.id} and (user_id is null or user_id=${appUser.id})
    `;
    await tx`update shorts_mvp.youtube_analyses set user_id=${appUser.id} where mvp_session_id=${activeSession.id} and user_id is null`;
    await tx`update shorts_mvp.video_jobs set user_id=${appUser.id} where mvp_session_id=${activeSession.id} and user_id is null`;
    await tx`update shorts_mvp.generated_shorts set user_id=${appUser.id} where mvp_session_id=${activeSession.id} and user_id is null`;
    await tx`update shorts_mvp.usage_reservations set user_id=${appUser.id} where mvp_session_id=${activeSession.id} and user_id is null`;
    await tx`update shorts_mvp.usage_events set user_id=${appUser.id} where mvp_session_id=${activeSession.id} and user_id is null`;

    return { appUser, activeSession };
  });
  try {
    await issueLoginWelcomeGrantIfEligible(db, claimed.appUser.id);
  } catch (error) {
    console.error("login_welcome_grant_failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }
  cookieStore.delete(REFERRAL_COOKIE);

  return {
    id: claimed.activeSession.id,
    selectedPlanCode: claimed.appUser.selectedPlanCode,
    userId: claimed.appUser.id,
    user: profile,
  };
}
