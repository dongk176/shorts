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
