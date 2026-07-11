import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";

const COOKIE_NAME = "shorts_mvp_session";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireMvpSession() {
  const cookieStore = await cookies();
  let token = cookieStore.get(COOKIE_NAME)?.value;
  const db = getDb();

  if (token) {
    const tokenHash = hashToken(token);
    const rows = await db`
      update shorts_mvp.mvp_sessions
      set last_seen_at = now()
      where token_hash = ${tokenHash}
      returning id, selected_plan_code
    `;
    if (rows[0]) return rows[0] as { id: string; selectedPlanCode: string };
  }

  token = randomBytes(32).toString("base64url");
  const rows = await db`
    insert into shorts_mvp.mvp_sessions (token_hash)
    values (${hashToken(token)})
    returning id, selected_plan_code
  `;
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return rows[0] as { id: string; selectedPlanCode: string };
}
