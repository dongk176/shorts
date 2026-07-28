import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/202607280004_editor_launch_bonus.sql", import.meta.url),
  "utf8",
);

test("editor launch bonus uses the strict KST cutoff and paid active entitlements", () => {
  assert.match(
    migration,
    /s\.status='active'[\s\S]*s\.plan_code<>'free'[\s\S]*p\.monthly_source_seconds>0/,
  );
  assert.match(
    migration,
    /s\.current_period_start<=timestamptz '2026-07-28 15:00:00\+09'/,
  );
  assert.match(
    migration,
    /s\.current_period_end>timestamptz '2026-07-28 15:00:00\+09'/,
  );
  assert.match(
    migration,
    /o\.status='succeeded'[\s\S]*o\.amount_krw>0[\s\S]*o\.approved_at<timestamptz '2026-07-28 15:00:00\+09'/,
  );
});

test("editor launch bonus grants each subscription exactly 100% for 90 days", () => {
  assert.match(
    migration,
    /e\.monthly_source_seconds,e\.monthly_source_seconds,0,[\s\S]*timestamptz '2026-10-26 15:00:00\+09'/,
  );
  assert.match(
    migration,
    /on conflict \(subscription_id,product_code\)[\s\S]*do nothing/,
  );
  assert.match(
    migration,
    /unique \(user_id,campaign_code\)/,
  );
});
