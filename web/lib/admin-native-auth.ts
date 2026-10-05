import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { AdminUser } from "@/lib/admin";

export const NATIVE_COOKIE = "__Secure-easycut-admin-native";
export const nativeHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const pkceChallenge = (value: string) => createHash("sha256").update(value).digest("base64url");
export async function nativeAdminUser(): Promise<AdminUser | null> {
  const token = (await cookies()).get(NATIVE_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await getDb()`select u.id,u.auth_user_id,u.email,u.display_name
    from shorts_mvp.admin_native_sessions s join shorts_mvp.app_users u on u.id=s.admin_id
    where s.token_hash=${nativeHash(token)} and s.expires_at>now() and u.is_admin`;
  return row ? { id: row.id, authUserId: row.authUserId, email: row.email, displayName: row.displayName } : null;
}
export async function createNativeCode(adminId: string, challenge: string) {
  const code = randomBytes(32).toString("base64url");
  await getDb().begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${"native-login:" + adminId}))`;
    await tx`delete from shorts_mvp.admin_native_auth_codes where expires_at<=now()`;
    await tx`delete from shorts_mvp.admin_native_sessions where expires_at<=now()`;
    const [count] = await tx`select count(*)::int as n from shorts_mvp.admin_native_auth_codes where admin_id=${adminId}`;
    if (Number(count.n)>=10) throw new HttpError(429,"잠시 후 다시 로그인해주세요.");
    await tx`insert into shorts_mvp.admin_native_auth_codes(code_hash,admin_id,challenge)
      values(${nativeHash(code)},${adminId},${challenge})`;
  });
  return code;
}
export async function exchangeNativeCode(code: string, verifier: string) {
  const token = randomBytes(32).toString("base64url");
  await getDb().begin(async tx => {
    const [row] = await tx`delete from shorts_mvp.admin_native_auth_codes c
      using shorts_mvp.app_users u where c.admin_id=u.id and u.is_admin
      and c.code_hash=${nativeHash(code)} and c.challenge=${pkceChallenge(verifier)} and c.expires_at>now()
      returning c.admin_id`;
    if (!row) throw new HttpError(401,"로그인 연결이 만료됐어요. 다시 로그인해주세요.");
    await tx`insert into shorts_mvp.admin_native_sessions(token_hash,admin_id) values(${nativeHash(token)},${row.adminId})`;
    await tx`delete from shorts_mvp.admin_native_sessions where token_hash in
      (select token_hash from shorts_mvp.admin_native_sessions where admin_id=${row.adminId} order by created_at desc offset 20)`;
  });
  return token;
}
