import type { Sql } from "postgres";
import { HttpError } from "@/lib/http";
import {
  createPaymentTrackId,
  decryptCardToken,
  revokeThePayOneCard,
  ThePayOneError,
} from "@/lib/thepayone";

export const BILLING_CARD_VERIFICATION_TTL_MINUTES = 15;

export type BillingCardVerification = {
  id: string;
  userId: string;
  requestId: string;
  mode: "subscribe" | "change_subscription";
  planCode: string;
  billingCycle: "monthly" | "yearly";
  billingDay: string;
  status: string;
  providerOrderId: string;
  providerTransactionId: string | null;
  providerResultCode: string | null;
  billingKeyCiphertext: string | null;
  billingKeyIv: string | null;
  billingKeyTag: string | null;
  billingKeyHash: string | null;
  issuerName: string | null;
  cardType: string | null;
  acquirerName: string | null;
  cardLast4: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
};

type RevocationClaim = {
  id: string;
  billingKeyCiphertext: string;
  billingKeyIv: string;
  billingKeyTag: string;
};

function hasEncryptedCard(
  row: Partial<RevocationClaim>,
): row is RevocationClaim {
  return Boolean(
    row.id
    && row.billingKeyCiphertext
    && row.billingKeyIv
    && row.billingKeyTag,
  );
}

async function revokeClaimedVerification(
  db: Sql,
  claimed: RevocationClaim,
  finalStatus: "revoked" | "expired",
) {
  const cardId = decryptCardToken({
    ciphertext: claimed.billingKeyCiphertext,
    iv: claimed.billingKeyIv,
    tag: claimed.billingKeyTag,
  }, claimed.id);
  const orderId = createPaymentTrackId("AUDT");
  try {
    const result = await revokeThePayOneCard(cardId, orderId);
    await db`
      update shorts_mvp.billing_card_verifications
      set status=${finalStatus},revocation_order_id=${orderId},
        revocation_transaction_id=${result.providerTransactionId},
        revocation_result_code=${result.resultCode},revoked_at=clock_timestamp(),
        billing_key_ciphertext=null,billing_key_iv=null,
        billing_key_tag=null,billing_key_hash=null
      where id=${claimed.id} and status='revoking'
    `;
    return finalStatus;
  } catch (error) {
    await db`
      update shorts_mvp.billing_card_verifications
      set status='revoke_failed',revocation_order_id=${orderId},
        revocation_result_code=${error instanceof ThePayOneError ? error.resultCode : "LOCAL_ERROR"}
      where id=${claimed.id} and status='revoking'
    `.catch(() => undefined);
    throw error;
  }
}

export async function revokeOwnedBillingCardVerification(
  db: Sql,
  verificationId: string,
  userId: string,
) {
  const claimedRows = await db`
    update shorts_mvp.billing_card_verifications
    set status='revoking'
    where id=${verificationId} and user_id=${userId}
      and status in ('active','revoke_failed')
    returning id,billing_key_ciphertext,billing_key_iv,billing_key_tag
  ` as unknown as RevocationClaim[];
  const claimed = claimedRows[0];
  if (claimed && hasEncryptedCard(claimed)) {
    return revokeClaimedVerification(db, claimed, "revoked");
  }

  const rows = await db`
    select status from shorts_mvp.billing_card_verifications
    where id=${verificationId} and user_id=${userId}
    limit 1
  `;
  const status = rows[0]?.status ? String(rows[0].status) : null;
  if (!status) throw new HttpError(404, "폐기할 카드 인증을 찾을 수 없습니다.");
  if (["revoked", "expired", "consumed"].includes(status)) return status;
  if (status === "pending" || status === "revoking" || status === "consuming") {
    throw new HttpError(409, "카드 인증을 처리하고 있습니다. 잠시 후 다시 시도해 주세요.");
  }
  throw new HttpError(409, "이 카드 인증은 더 이상 사용할 수 없습니다.");
}

export async function cleanupExpiredBillingCardVerifications(
  db: Sql,
  limit = 100,
) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const candidates = await db`
    select id
    from shorts_mvp.billing_card_verifications
    where expires_at <= clock_timestamp()
      and status in ('active','revoke_failed')
    order by expires_at
    limit ${boundedLimit}
  `;
  let revoked = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claimedRows = await db`
      update shorts_mvp.billing_card_verifications
      set status='revoking'
      where id=${candidate.id}
        and expires_at <= clock_timestamp()
        and status in ('active','revoke_failed')
      returning id,billing_key_ciphertext,billing_key_iv,billing_key_tag
    ` as unknown as RevocationClaim[];
    const claimed = claimedRows[0];
    if (!claimed || !hasEncryptedCard(claimed)) continue;
    try {
      await revokeClaimedVerification(db, claimed, "expired");
      revoked += 1;
    } catch {
      failed += 1;
    }
  }
  return { selected: candidates.length, revoked, failed };
}
