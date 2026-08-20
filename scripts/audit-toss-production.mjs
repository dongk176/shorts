#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import postgres from "../web/node_modules/postgres/src/index.js";

function loadEnvironment(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
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

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.resolve(option("env-file", path.join(root, ".env.local")));
const email = option("email").trim().toLowerCase();
loadEnvironment(envFile);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL이 필요합니다.");

const expectedPlans = new Map([
  ["toss_easycut_pro_1m", [1, 9_900]],
  ["toss_easycut_pro_6m", [6, 53_400]],
  ["toss_easycut_pro_12m", [12, 82_800]],
  ["toss_starter_1m", [1, 24_900]],
  ["toss_starter_6m", [6, 119_400]],
  ["toss_starter_12m", [12, 178_800]],
  ["toss_expert_1m", [1, 59_000]],
  ["toss_expert_6m", [6, 247_800]],
  ["toss_expert_12m", [12, 354_000]],
]);

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 5,
  connection: {
    application_name: "easycut-toss-production-audit",
    default_transaction_read_only: true,
    statement_timeout: 10_000,
  },
  transform: postgres.camel,
});

try {
  const [schema] = await sql`
    select
      to_regclass('shorts_mvp.billing_customer_cohorts') is not null as cohorts,
      to_regclass('shorts_mvp.billing_toss_transactions') is not null as transactions,
      to_regclass('shorts_mvp.billing_toss_checkout_intents') is not null as checkout_intents,
      to_regclass('shorts_mvp.billing_toss_webhook_events') is not null as webhook_events,
      to_regclass('shorts_mvp.billing_payment_methods_toss_customer_active_idx') is not null
        as payment_method_index,
      to_regclass('shorts_mvp.user_subscriptions_one_current_toss_idx') is not null
        as subscription_index
  `;
  for (const [name, present] of Object.entries(schema)) {
    assert.equal(present, true, `운영 DB에 ${name}이(가) 없습니다.`);
  }

  const plans = await sql`
    select code,prepaid_months,yearly_price_krw,is_active
    from shorts_mvp.plans
    where code like 'toss_%'
    order by code
  `;
  assert.equal(plans.length, expectedPlans.size, "운영 DB의 Toss 요금제 수가 다릅니다.");
  for (const plan of plans) {
    const expected = expectedPlans.get(plan.code);
    assert.ok(expected, `알 수 없는 Toss 요금제입니다: ${plan.code}`);
    assert.equal(Number(plan.prepaidMonths), expected[0], `${plan.code} 기간이 다릅니다.`);
    assert.equal(Number(plan.yearlyPriceKrw), expected[1], `${plan.code} 가격이 다릅니다.`);
    assert.equal(plan.isActive, false, `${plan.code}가 전체 공개되어 있습니다.`);
  }

  const [ledger] = await sql`
    select
      count(*) filter (where transaction_type='payment')::int as payments,
      count(*) filter (where transaction_type='cancellation')::int as cancellations,
      count(*) filter (where status in ('unknown','processing'))::int as unresolved,
      count(*) filter (where fulfillment_status='manual_review')::int as manual_reviews
    from shorts_mvp.billing_toss_transactions
  `;

  let account = null;
  if (email) {
    const [row] = await sql`
      select
        account.email,
        cohort.cohort,
        subscription.plan_code,
        subscription.status,
        subscription.contract_months,
        subscription.billing_price_krw,
        subscription.scheduled_plan_code,
        subscription.scheduled_contract_months,
        subscription.scheduled_billing_price_krw,
        subscription.current_period_end,
        method_stats.active_toss_methods,
        method_stats.encrypted_toss_methods,
        usage_stats.remaining_seconds
      from shorts_mvp.app_users account
      left join shorts_mvp.billing_customer_cohorts cohort on cohort.user_id=account.id
      left join shorts_mvp.user_subscriptions subscription
        on subscription.user_id=account.id
       and subscription.payment_provider='toss'
       and subscription.status in ('pending','trialing','active','past_due')
      left join lateral (
        select
          count(*) filter (
            where method.provider='toss' and method.status='active'
          )::int as active_toss_methods,
          count(*) filter (
            where method.provider='toss'
              and method.billing_key_ciphertext is not null
              and method.billing_key_iv is not null
              and method.billing_key_tag is not null
          )::int as encrypted_toss_methods
        from shorts_mvp.billing_payment_methods method
        where method.user_id=account.id
      ) method_stats on true
      left join lateral (
        select coalesce(sum(
          grant_row.total_seconds-grant_row.consumed_seconds-grant_row.reserved_seconds
        ),0)::int as remaining_seconds
        from shorts_mvp.usage_grants grant_row
        where grant_row.user_id=account.id
          and grant_row.status='active'
          and grant_row.valid_from<=now()
          and grant_row.expires_at>now()
      ) usage_stats on true
      where lower(account.email)=lower(${email})
      limit 1
    `;
    assert.ok(row, "점검할 계정을 찾지 못했습니다.");
    account = {
      email: row.email,
      cohort: row.cohort,
      planCode: row.planCode,
      status: row.status,
      contractMonths: row.contractMonths == null ? null : Number(row.contractMonths),
      billingPriceKrw: row.billingPriceKrw == null ? null : Number(row.billingPriceKrw),
      scheduledPlanCode: row.scheduledPlanCode,
      scheduledContractMonths: row.scheduledContractMonths == null
        ? null
        : Number(row.scheduledContractMonths),
      scheduledBillingPriceKrw: row.scheduledBillingPriceKrw == null
        ? null
        : Number(row.scheduledBillingPriceKrw),
      currentPeriodEnd: row.currentPeriodEnd,
      activeTossMethods: Number(row.activeTossMethods),
      encryptedTossMethods: Number(row.encryptedTossMethods),
      remainingMinutes: Math.floor(Number(row.remainingSeconds) / 60),
    };
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    schema,
    plans: plans.map((plan) => ({
      code: plan.code,
      months: Number(plan.prepaidMonths),
      priceKrw: Number(plan.yearlyPriceKrw),
      public: plan.isActive,
    })),
    ledger: {
      payments: Number(ledger.payments),
      cancellations: Number(ledger.cancellations),
      unresolved: Number(ledger.unresolved),
      manualReviews: Number(ledger.manualReviews),
    },
    account,
  }, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 });
}
