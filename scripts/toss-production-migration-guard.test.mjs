import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaMigration = fs.readFileSync(
  new URL("../supabase/migrations/202608200001_toss_production_billing.sql", import.meta.url),
  "utf8",
);
const indexMigration = fs.readFileSync(
  new URL("../supabase/migrations/202608200002_toss_production_billing_indexes.sql", import.meta.url),
  "utf8",
);
const saleCatalogMigration = fs.readFileSync(
  new URL("../supabase/migrations/202608250001_toss_catalog_3_6_12_recurring.sql", import.meta.url),
  "utf8",
);

test("Toss billing schema migration never rewrites existing production rows", () => {
  assert.match(schemaMigration, /set local lock_timeout = '3s'/i);
  assert.doesNotMatch(
    schemaMigration,
    /\b(?:update|delete\s+from|truncate)\s+shorts_mvp\.(?:app_users|billing_orders|billing_payment_methods|user_subscriptions|usage_grants)\b/i,
  );
  assert.doesNotMatch(schemaMigration, /\bdrop\s+(?:table|column)\b/i);
  assert.doesNotMatch(schemaMigration, /\bvalidate\s+constraint\b/i);
});

test("Toss plans remain hidden until an explicit rollout", () => {
  const tossPlanRows = schemaMigration.match(/\('toss_[^\n]+/g) ?? [];
  assert.equal(tossPlanRows.length, 9);
  for (const row of tossPlanRows) assert.match(row, /,false,/i);
});

test("Toss ledger is database-locked to immutable Toss cohorts and preserves its audit trail", () => {
  assert.match(
    schemaMigration,
    /before\s+update\s+on\s+shorts_mvp\.billing_customer_cohorts/i,
  );
  assert.doesNotMatch(
    schemaMigration,
    /before\s+update\s+or\s+delete\s+on\s+shorts_mvp\.billing_customer_cohorts/i,
  );
  assert.match(
    schemaMigration,
    /cohort\s+text\s+not\s+null\s+default\s+'toss_v1'\s+check\s*\(cohort='toss_v1'\)/i,
  );
  assert.match(
    schemaMigration,
    /foreign\s+key\s*\(user_id,cohort\)[\s\S]*references\s+shorts_mvp\.billing_customer_cohorts\(user_id,cohort\)/i,
  );
});

test("indexes on live legacy tables are built concurrently in an isolated migration", () => {
  assert.doesNotMatch(schemaMigration, /create\s+(?:unique\s+)?index\s+concurrently/i);
  assert.match(indexMigration, /set lock_timeout = '3s'/i);
  assert.equal((indexMigration.match(/create unique index concurrently/gi) ?? []).length, 2);
  assert.match(indexMigration, /where provider='toss'/i);
  assert.match(indexMigration, /where payment_provider='toss'/i);
});

test("the sale catalog adds exact package totals without repricing legacy Pro", () => {
  assert.match(saleCatalogMigration, /'toss_starter_3m'[^\n]+30,153,23655,70965/i);
  assert.match(saleCatalogMigration, /'toss_expert_3m'[^\n]+30,163,49000,147000/i);
  for (const [code, monthly, total] of [
    ["toss_starter_6m", 19900, 119400],
    ["toss_starter_12m", 16500, 198000],
    ["toss_expert_6m", 48000, 288000],
    ["toss_expert_12m", 36000, 432000],
  ]) {
    assert.match(
      saleCatalogMigration,
      new RegExp(`monthly_price_krw=${monthly},[^;]+yearly_price_krw=${total}[^;]+where code='${code}'`, "i"),
    );
  }
  assert.doesNotMatch(
    saleCatalogMigration,
    /update\s+shorts_mvp\.plans[\s\S]*?where\s+code='toss_easycut_pro_(?:6m|12m)'/i,
  );
  assert.match(
    saleCatalogMigration,
    /contract_months\s+is\s+null\s+or\s+contract_months\s+in\s*\(1,3,6,12\)/i,
  );
  assert.match(
    saleCatalogMigration,
    /active Toss package contract requires a versioned product migration/i,
  );
});
