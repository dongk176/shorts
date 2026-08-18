#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "../web/node_modules/postgres/src/index.js";

function loadLocalEnvironment(envFile) {
  if (!fs.existsSync(envFile)) return;
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    process.env[name] ||= value;
  }
}

export function validateBillingAudit(audit) {
  assert.equal(audit.plan?.code, "easycut_pro_v2", "운영 Pro 상품을 찾지 못했습니다.");
  assert.equal(Number(audit.plan.monthlyPriceKrw), 9_900, "운영 Pro 가격이 9,900원이 아닙니다.");
  assert.equal(audit.plan.isActive, true, "운영 Pro 상품이 비활성 상태입니다.");
  assert.ok(Number(audit.successfulInitialPro?.orders) > 0, "최근 성공한 Pro 최초 결제가 없습니다.");
  assert.equal(Number(audit.successfulInitialPro.minAmount), 9_900, "Pro 최소 승인액이 9,900원이 아닙니다.");
  assert.equal(Number(audit.successfulInitialPro.maxAmount), 9_900, "Pro 최대 승인액이 9,900원이 아닙니다.");
  assert.equal(Number(audit.registrationTrackIds.invalidLength), 0, "신규 정기등록 트랙 ID 중 31자가 아닌 값이 있습니다.");
  assert.ok(Number(audit.packageReplacements.orders) > 0, "최근 Pro→패키지 성공 근거가 없습니다.");
  assert.equal(Number(audit.packageReplacements.refundMismatches), 0, "Pro 전액환불이 확인되지 않은 성공 전환이 있습니다.");
  assert.equal(Number(audit.packageReplacements.activationMismatches), 0, "패키지가 활성화되지 않은 성공 전환이 있습니다.");
  assert.equal(Number(audit.newManualReviews.orders), 0, "점검 시작 뒤 새 manual_review 결제가 있습니다.");
  return audit;
}

function parseOptions(argv, root) {
  const index = argv.indexOf("--since");
  const raw = index >= 0 ? argv[index + 1] : null;
  const since = raw ? new Date(raw) : new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime())) throw new Error("--since 시각이 올바르지 않습니다.");
  const envIndex = argv.indexOf("--env-file");
  const envFile = envIndex >= 0
    ? path.resolve(argv[envIndex + 1] || "")
    : path.join(root, ".env.local");
  return { since, envFile };
}

export async function runBillingAudit(argv = process.argv.slice(2)) {
  const root = path.resolve(import.meta.dirname, "..");
  const { since, envFile } = parseOptions(argv, root);
  loadLocalEnvironment(envFile);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 필요합니다.");
  const sql = postgres(process.env.DATABASE_URL, {
    max: 1,
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
    transform: postgres.camel,
  });
  try {
    const [plan] = await sql`
      select code,monthly_price_krw,is_active
      from shorts_mvp.plans
      where code='easycut_pro_v2'
      limit 1
    `;
    const [successfulInitialPro] = await sql`
      select count(*)::int as orders,
        min(amount_krw)::int as min_amount,max(amount_krw)::int as max_amount
      from shorts_mvp.billing_orders
      where product_code='easycut_pro_v2'
        and kind='subscription_initial' and status='succeeded'
        and created_at>=now()-interval '30 days'
    `;
    const [registrationTrackIds] = await sql`
      select count(*)::int as registrations,
        count(*) filter (where length(registration_order_id)<>31)::int as invalid_length
      from shorts_mvp.billing_payment_methods
      where provider='thepayone' and registration_order_id is not null
        and created_at>=${since}
    `;
    const [packageReplacements] = await sql`
      with replacements as (
        select id,subscription_id,product_code,approved_at
        from shorts_mvp.billing_orders
        where kind='subscription_change' and status='succeeded'
          and product_code in (
            'starter_3m','starter_6m','starter_12m',
            'expert_3m','expert_6m','expert_12m'
          )
          and proration_credit_krw=9900
          and created_at>=now()-interval '30 days'
      )
      select count(*)::int as orders,
        count(*) filter (where not exists (
          select 1 from shorts_mvp.billing_orders pro
          where pro.subscription_id=replacements.subscription_id
            and pro.product_code='easycut_pro_v2'
            and pro.status='succeeded'
            and pro.refunded_amount_krw=9900
            and pro.refund_status='full'
            and pro.proration_refund_status='succeeded'
            and pro.approved_at<=replacements.approved_at
        ))::int as refund_mismatches,
        count(*) filter (where not exists (
          select 1 from shorts_mvp.user_subscriptions subscription
          where subscription.id=replacements.subscription_id
            and subscription.plan_code=replacements.product_code
            and exists (
              select 1 from shorts_mvp.usage_grants grant_row
              where grant_row.billing_order_id=replacements.id
                and grant_row.subscription_id=subscription.id
                and grant_row.product_code=replacements.product_code
                and grant_row.kind='base'
            )
        ))::int as activation_mismatches
      from replacements
    `;
    const [newManualReviews] = await sql`
      select count(*)::int as orders
      from shorts_mvp.billing_orders
      where status='manual_review' and created_at>=${since}
    `;
    const audit = validateBillingAudit({
      plan,
      successfulInitialPro,
      registrationTrackIds,
      packageReplacements,
      newManualReviews,
    });
    process.stdout.write(JSON.stringify({
      ok: true,
      checkedSince: since.toISOString(),
      easycutPro: {
        monthlyPriceKrw: Number(audit.plan.monthlyPriceKrw),
        successfulInitialOrders: Number(audit.successfulInitialPro.orders),
      },
      registrationTrackIds: {
        checked: Number(audit.registrationTrackIds.registrations),
        invalidLength: Number(audit.registrationTrackIds.invalidLength),
      },
      packageReplacements: {
        checked: Number(audit.packageReplacements.orders),
        refundMismatches: Number(audit.packageReplacements.refundMismatches),
        activationMismatches: Number(audit.packageReplacements.activationMismatches),
      },
      newManualReviews: Number(audit.newManualReviews.orders),
    }, null, 2) + "\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runBillingAudit().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
