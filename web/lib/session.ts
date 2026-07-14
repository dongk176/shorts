import { createHash, randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
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

function authProfile(user: User): AuthProfile {
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

export async function requireMvpSession(authenticatedUser?: User | null): Promise<MvpSession> {
  const cookieStore = await cookies();
  let token = cookieStore.get(MVP_SESSION_COOKIE)?.value;
  const db = getDb();
  let existing: { id: string; selectedPlanCode: string; userId: string | null } | undefined;

  if (token) {
    const rows = await db`
      update shorts_mvp.mvp_sessions
      set last_seen_at = now()
      where token_hash = ${hashToken(token)}
      returning id, selected_plan_code, user_id
    `;
    existing = rows[0] as typeof existing;
  }

  const authUser = authenticatedUser === undefined ? await getAuthenticatedUser() : authenticatedUser;
  if (!authUser) {
    if (existing && !existing.userId) {
      return { ...existing, user: null };
    }
    token = randomBytes(32).toString("base64url");
    const rows = await db`
      insert into shorts_mvp.mvp_sessions (token_hash)
      values (${hashToken(token)})
      returning id, selected_plan_code, user_id
    `;
    setSessionCookie(cookieStore, token);
    return { ...(rows[0] as Omit<MvpSession, "user">), user: null };
  }

  const profile = authProfile(authUser);
  const preferredPlan = existing?.selectedPlanCode || "plus";
  const provider = profileValue(authUser.app_metadata?.provider, 100) || "google";
  const appUsers = await db`
    insert into shorts_mvp.app_users (
      auth_user_id, email, display_name, avatar_url, provider,
      selected_plan_code, last_sign_in_at
    ) values (
      ${authUser.id}, ${profile.email}, ${profile.displayName}, ${profile.avatarUrl},
      ${provider}, ${preferredPlan}, ${authUser.last_sign_in_at || new Date().toISOString()}
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

  if (!existing || (existing.userId && existing.userId !== appUser.id)) {
    token = randomBytes(32).toString("base64url");
    const rows = await db`
      insert into shorts_mvp.mvp_sessions (token_hash, selected_plan_code, user_id)
      values (${hashToken(token)}, ${appUser.selectedPlanCode}, ${appUser.id})
      returning id, selected_plan_code, user_id
    `;
    existing = rows[0] as typeof existing;
    setSessionCookie(cookieStore, token);
  }
  if (!existing) throw new Error("로그인 세션을 만들지 못했습니다.");
  const activeSession = existing;

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
