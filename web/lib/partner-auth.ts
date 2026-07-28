import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { createReferralToken, referralTokenHash } from "@/lib/referral-security";

export const PARTNER_SESSION_COOKIE = "easycut_partner_session";
const PARTNER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type PartnerSession = {
  id: string;
  partnerId: string;
  creatorName: string;
  slug: string;
  status: "active" | "paused";
  commissionRateBps: number;
  loginId: string;
  mustChangePassword: boolean;
};

export async function createPartnerSession(partnerId: string) {
  const token = createReferralToken();
  const rows = await getDb()`
    insert into shorts_mvp.referral_partner_sessions (
      partner_id,token_hash,expires_at
    ) values (
      ${partnerId},${referralTokenHash(token)},
      now()+${PARTNER_SESSION_MAX_AGE_SECONDS}*interval '1 second'
    )
    returning id
  `;
  const cookieStore = await cookies();
  cookieStore.set(PARTNER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PARTNER_SESSION_MAX_AGE_SECONDS,
  });
  return String(rows[0].id);
}

export async function revokePartnerSessions(partnerId: string) {
  await getDb()`
    update shorts_mvp.referral_partner_sessions
    set revoked_at=coalesce(revoked_at,now())
    where partner_id=${partnerId} and revoked_at is null
  `;
}

export async function clearPartnerSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PARTNER_SESSION_COOKIE)?.value;
  if (token) {
    await getDb()`
      update shorts_mvp.referral_partner_sessions
      set revoked_at=coalesce(revoked_at,now())
      where token_hash=${referralTokenHash(token)} and revoked_at is null
    `;
  }
  cookieStore.delete(PARTNER_SESSION_COOKIE);
}

export async function getPartnerSession(): Promise<PartnerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PARTNER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await getDb()`
    select s.id,s.partner_id,p.creator_name,p.slug,p.status,p.commission_rate_bps,
      c.login_id,c.must_change_password,s.last_seen_at
    from shorts_mvp.referral_partner_sessions s
    join shorts_mvp.referral_partners p on p.id=s.partner_id
    join shorts_mvp.referral_partner_credentials c on c.partner_id=p.id
    where s.token_hash=${referralTokenHash(token)}
      and s.revoked_at is null
      and s.expires_at>now()
      and p.status in ('active','paused')
    limit 1
  `;
  const row = rows[0];
  if (!row) {
    cookieStore.delete(PARTNER_SESSION_COOKIE);
    return null;
  }
  if (row.lastSeenAt instanceof Date && row.lastSeenAt.getTime() < Date.now() - 5 * 60 * 1000) {
    await getDb()`
      update shorts_mvp.referral_partner_sessions
      set last_seen_at=now()
      where id=${row.id} and last_seen_at<now()-interval '5 minutes'
    `;
  }
  return {
    id: row.id,
    partnerId: row.partnerId,
    creatorName: row.creatorName,
    slug: row.slug,
    status: row.status,
    commissionRateBps: Number(row.commissionRateBps),
    loginId: row.loginId,
    mustChangePassword: Boolean(row.mustChangePassword),
  };
}

export async function requirePartnerSession() {
  const session = await getPartnerSession();
  if (!session) throw new HttpError(401, "파트너 로그인이 필요합니다.", "PARTNER_LOGIN_REQUIRED");
  return session;
}
