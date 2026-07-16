import { createHash, randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export const MVP_SESSION_COOKIE = "shorts_mvp_session";

export type AuthProfile = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

export type MvpSession = {
  id: string;
  selectedPlanCode: string;
  userId: string | null;
  user: AuthProfile | null;
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
  db: ReturnType<typeof getDb>,
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  userId: string | null,
  selectedPlanCode = "plus",
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

export async function requireMvpSession(authenticatedUser?: User | null): Promise<MvpSession> {
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
    select id, selected_plan_code
    from shorts_mvp.app_users
    where auth_user_id=${authUser.id}
    limit 1
  `;
  const appUser = appUsers[0] as { id: string; selectedPlanCode: string } | undefined;
  if (!appUser) throw new Error("로그인 계정 연결이 완료되지 않았습니다. 다시 로그인해 주세요.");

  const activeSession = existing?.userId === appUser.id
    ? existing
    : await createStoredSession(db, cookieStore, appUser.id, appUser.selectedPlanCode);

  return {
    id: activeSession.id,
    selectedPlanCode: appUser.selectedPlanCode,
    userId: appUser.id,
    user: profile,
  };
}

export async function requireAuthenticatedMvpSession(): Promise<MvpSession & { userId: string }> {
  const session = await requireMvpSession();
  if (!session.userId) throw new HttpError(401, "로그인이 필요합니다.");
  return session as MvpSession & { userId: string };
}

export async function claimMvpSession(authenticatedUser: User): Promise<MvpSession> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MVP_SESSION_COOKIE)?.value;
  const db = getDb();
  const existing = await findStoredSession(db, token);
  const profile = authProfile(authenticatedUser);
  const preferredPlan = existing?.selectedPlanCode || "plus";
  const provider = profileValue(authenticatedUser.app_metadata?.provider, 100) || "google";
  const appUsers = await db`
    insert into shorts_mvp.app_users (
      auth_user_id, email, display_name, avatar_url, provider,
      selected_plan_code, last_sign_in_at
    ) values (
      ${authenticatedUser.id}, ${profile.email}, ${profile.displayName}, ${profile.avatarUrl},
      ${provider}, ${preferredPlan}, ${authenticatedUser.last_sign_in_at || new Date().toISOString()}
    )
    on conflict (auth_user_id) do update set
      email=excluded.email,
      display_name=excluded.display_name,
      avatar_url=excluded.avatar_url,
      provider=excluded.provider,
      last_sign_in_at=excluded.last_sign_in_at
    returning id, selected_plan_code
  `;
  const appUser = appUsers[0] as { id: string; selectedPlanCode: string };
  const activeSession = !existing || (existing.userId && existing.userId !== appUser.id)
    ? await createStoredSession(db, cookieStore, appUser.id, appUser.selectedPlanCode)
    : existing;

  await db.begin(async (tx) => {
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
  });

  return {
    id: activeSession.id,
    selectedPlanCode: appUser.selectedPlanCode,
    userId: appUser.id,
    user: profile,
  };
}
