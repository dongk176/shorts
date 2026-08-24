import {
  createDecipheriv,
  randomUUID,
} from "node:crypto";
import process from "node:process";
import postgres from "../web/node_modules/postgres/src/index.js";

const emailArg = process.argv.find((value) => value.startsWith("--email="));
const confirmArg = process.argv.find((value) => value.startsWith("--confirm="));
const email = emailArg?.slice("--email=".length).trim().toLowerCase();
const confirmation = confirmArg?.slice("--confirm=".length);

if (!email || confirmation !== `RESET:${email}`) {
  throw new Error("정확한 --email과 --confirm=RESET:<email>을 지정해야 합니다.");
}

for (const name of [
  "DATABASE_URL",
  "THEPAYONE_API_BASE_URL",
  "THEPAYONE_PAY_KEY",
  "THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY",
]) {
  if (!process.env[name]) throw new Error(`${name} 환경변수가 필요합니다.`);
}

const encryptionKey = Buffer.from(
  process.env.THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY,
  "base64",
);
if (encryptionKey.length !== 32) {
  throw new Error("THEPAYONE_CARD_TOKEN_ENCRYPTION_KEY 형식이 올바르지 않습니다.");
}

const apiBaseUrl = new URL(process.env.THEPAYONE_API_BASE_URL);
if (apiBaseUrl.protocol !== "https:" || apiBaseUrl.username || apiBaseUrl.password) {
  throw new Error("더페이원 API 주소가 올바르지 않습니다.");
}

function decryptCardId(method) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(method.billing_key_iv, "base64"),
  );
  decipher.setAAD(Buffer.from(method.id, "utf8"));
  decipher.setAuthTag(Buffer.from(method.billing_key_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(method.billing_key_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function auditTrackId() {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `EC-AUDT-${timestamp}-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

async function revokeCard(cardId) {
  const response = await fetch(new URL("/api/audt", apiBaseUrl), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: process.env.THEPAYONE_PAY_KEY,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      audt: {
        cardId,
        status: "폐기",
        trackId: auditTrackId(),
      },
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  const resultCode = body?.result?.resultCd;
  if (!response.ok || resultCode !== "0000") {
    throw new Error(`더페이원 카드 폐기 실패 (${String(resultCode || response.status).slice(0, 32)})`);
  }
  return body?.audt?.trxId || null;
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
});

try {
  const users = await sql`
    select id,email,selected_plan_code
    from shorts_mvp.app_users
    where lower(email)=lower(${email})
    limit 2
  `;
  if (users.length !== 1) {
    throw new Error("초기화할 사용자를 정확히 하나 찾지 못했습니다.");
  }
  const user = users[0];
  const activeReservations = await sql`
    select id from shorts_mvp.usage_reservations
    where user_id=${user.id} and status='reserved'
    limit 1
  `;
  if (activeReservations[0]) {
    throw new Error("진행 중인 작업의 사용시간 예약이 있어 초기화를 중단했습니다.");
  }
  const methods = await sql`
    select id,billing_key_ciphertext,billing_key_iv,billing_key_tag,
      status,provider_schedule_status
    from shorts_mvp.billing_payment_methods
    where user_id=${user.id} and provider='thepayone'
    order by created_at
  `;

  const revocations = [];
  for (const method of methods) {
    const cardId = decryptCardId(method);
    const providerTransactionId = await revokeCard(cardId);
    revocations.push({
      paymentMethodId: method.id,
      previousStatus: method.provider_schedule_status,
      providerTransactionId,
    });
  }

  const removed = await sql.begin(async (tx) => {
    const counts = {};
    counts.upgradeRefunds = (await tx`
      delete from shorts_mvp.subscription_upgrade_refunds
      where user_id=${user.id}
      returning id
    `).length;
    counts.adminRefunds = (await tx`
      delete from shorts_mvp.admin_billing_refunds
      where billing_order_id in (
        select id from shorts_mvp.billing_orders where user_id=${user.id}
      )
      returning id
    `).length;
    counts.adminSubscriptionChanges = (await tx`
      delete from shorts_mvp.admin_subscription_changes
      where user_id=${user.id}
        or subscription_id in (
          select id from shorts_mvp.user_subscriptions where user_id=${user.id}
        )
      returning id
    `).length;
    counts.paymentEvents = (await tx`
      delete from shorts_mvp.billing_payment_events
      where billing_order_id in (
          select id from shorts_mvp.billing_orders where user_id=${user.id}
        )
        or subscription_id in (
          select id from shorts_mvp.user_subscriptions where user_id=${user.id}
        )
        or payment_method_id in (
          select id from shorts_mvp.billing_payment_methods where user_id=${user.id}
        )
      returning id
    `).length;
    counts.grantAllocations = (await tx`
      delete from shorts_mvp.usage_grant_allocations
      where grant_id in (
        select id from shorts_mvp.usage_grants where user_id=${user.id}
      )
      returning id
    `).length;
    counts.usageGrants = (await tx`
      delete from shorts_mvp.usage_grants
      where user_id=${user.id}
      returning id
    `).length;
    counts.orders = (await tx`
      delete from shorts_mvp.billing_orders
      where user_id=${user.id}
      returning id
    `).length;
    counts.subscriptions = (await tx`
      delete from shorts_mvp.user_subscriptions
      where user_id=${user.id}
      returning id
    `).length;
    counts.paymentMethods = (await tx`
      delete from shorts_mvp.billing_payment_methods
      where user_id=${user.id}
      returning id
    `).length;
    await tx`
      update shorts_mvp.app_users
      set selected_plan_code='free'
      where id=${user.id}
    `;
    await tx`
      update shorts_mvp.mvp_sessions
      set selected_plan_code='free'
      where user_id=${user.id}
    `;
    return counts;
  });

  process.stdout.write(`${JSON.stringify({
    email: user.email,
    selectedPlanCode: "free",
    revokedCards: revocations.length,
    removed,
  }, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 3 });
}
