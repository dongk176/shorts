import {
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "../web/node_modules/postgres/src/index.js";

const root = path.resolve(import.meta.dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnv(path.join(root, ".env.local"));

const ids = process.argv
  .slice(2)
  .filter((value) => value.startsWith("--subscription="))
  .map((value) => value.slice("--subscription=".length));
if (!ids.length || ids.some((value) => !/^[a-f0-9-]{36}$/i.test(value))) {
  throw new Error("삭제할 구독을 --subscription=<uuid>로 하나 이상 정확히 지정해야 합니다.");
}
for (const name of [
  "DATABASE_URL",
  "NICEPAY_CLIENT_KEY",
  "NICEPAY_SECRET_KEY",
  "NICEPAY_BILLING_KEY_ENCRYPTION_KEY",
]) {
  if (!process.env[name]) throw new Error(`${name} 환경변수가 필요합니다.`);
}

const encryptionKey = Buffer.from(process.env.NICEPAY_BILLING_KEY_ENCRYPTION_KEY, "base64");
if (encryptionKey.length !== 32) throw new Error("Nicepay 빌링키 암호화 키 형식이 올바르지 않습니다.");
const apiBase = new URL(process.env.NICEPAY_API_BASE_URL || "https://api.nicepay.co.kr");
if (apiBase.protocol !== "https:" || apiBase.username || apiBase.password) {
  throw new Error("Nicepay API 주소가 올바르지 않습니다.");
}

function decryptBillingKey(method) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(method.billing_key_iv, "base64"));
  decipher.setAAD(Buffer.from(method.payment_method_id, "utf8"));
  decipher.setAuthTag(Buffer.from(method.billing_key_tag, "base64"));
  const billingKey = Buffer.concat([
    decipher.update(Buffer.from(method.billing_key_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const actualHash = createHash("sha256").update(billingKey, "utf8").digest("hex");
  if (actualHash !== method.billing_key_hash) {
    throw new Error("Nicepay BID 무결성 검증에 실패했습니다.");
  }
  return billingKey;
}

function signature(...values) {
  return createHash("sha256")
    .update(`${values.join("")}${process.env.NICEPAY_SECRET_KEY}`, "utf8")
    .digest("hex");
}

async function expireBillingKey(billingKey) {
  const orderId = `EXP-${Date.now().toString(36).toUpperCase()}-${randomBytes(8).toString("hex").toUpperCase()}`.slice(0, 64);
  const ediDate = new Date().toISOString();
  const authorization = Buffer.from(
    `${process.env.NICEPAY_CLIENT_KEY}:${process.env.NICEPAY_SECRET_KEY}`,
    "utf8",
  ).toString("base64");
  const response = await fetch(new URL(`/v1/subscribe/${encodeURIComponent(billingKey)}/expire`, apiBase), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/json;charset=utf-8",
    },
    body: JSON.stringify({
      orderId,
      ediDate,
      signData: signature(orderId, billingKey, ediDate),
      returnCharSet: "utf-8",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.resultCode !== "0000") {
    throw new Error(`Nicepay BID 폐기 실패 (${String(body.resultCode || response.status).slice(0, 40)})`);
  }
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 15 });
try {
  const subscriptions = await sql.unsafe(`
    select s.id,s.user_id,s.plan_code,s.billing_cycle,s.status,s.current_period_end,
      m.id as payment_method_id,m.provider,m.billing_key_ciphertext,m.billing_key_iv,m.billing_key_tag,
      m.billing_key_hash
    from shorts_mvp.user_subscriptions s
    join shorts_mvp.billing_payment_methods m on m.id=s.payment_method_id
    where s.id = any($1::uuid[])
    order by s.id
  `, [ids]);
  if (subscriptions.length !== ids.length) throw new Error("지정한 구독 중 현재 DB에서 찾을 수 없는 항목이 있습니다.");
  if (subscriptions.some((row) => row.provider !== "nicepay" || !["active", "past_due"].includes(row.status))) {
    throw new Error("활성 Nicepay 테스트 구독이 아닌 대상이 포함되어 중단했습니다.");
  }

  process.stdout.write(`${JSON.stringify(subscriptions.map((row) => ({
    subscriptionId: row.id,
    planCode: row.plan_code,
    billingCycle: row.billing_cycle,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
  })), null, 2)}\n`);

  for (const subscription of subscriptions) {
    const billingKey = decryptBillingKey(subscription);
    await expireBillingKey(billingKey);
    await sql.begin(async (tx) => {
      await tx`
        delete from shorts_mvp.usage_grant_allocations
        where grant_id in (
          select id from shorts_mvp.usage_grants where subscription_id=${subscription.id}
        )
      `;
      await tx`delete from shorts_mvp.user_subscriptions where id=${subscription.id}`;
      await tx`delete from shorts_mvp.billing_payment_methods where id=${subscription.payment_method_id}`;
      const remaining = await tx`
        select plan_code from shorts_mvp.user_subscriptions
        where user_id=${subscription.user_id} and status in ('active','past_due')
        order by created_at desc limit 1
      `;
      const planCode = remaining[0]?.plan_code || "free";
      await tx`update shorts_mvp.app_users set selected_plan_code=${planCode} where id=${subscription.user_id}`;
      await tx`update shorts_mvp.mvp_sessions set selected_plan_code=${planCode} where user_id=${subscription.user_id}`;
    });
    process.stdout.write(`Nicepay 테스트 구독 정리 완료: ${subscription.id}\n`);
  }
} finally {
  await sql.end({ timeout: 3 });
}
