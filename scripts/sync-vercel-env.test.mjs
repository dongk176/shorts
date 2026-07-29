import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(new URL("./sync-vercel-env.sh", import.meta.url), "utf8");

test("syncs the server-side Supabase Auth configuration to Vercel", () => {
  assert.match(script, /for name in[^\n]*DATABASE_URL SUPABASE_URL SUPABASE_PUBLISHABLE_KEY/);
});

test("syncs default and package ThePayOne credentials to Vercel", () => {
  assert.match(script, /THEPAYONE_BILLING_ENABLED THEPAYONE_MID THEPAYONE_TERMINAL_ID THEPAYONE_PAY_KEY/);
  assert.match(script, /THEPAYONE_PACKAGE_BILLING_ENABLED THEPAYONE_PACKAGE_MID/);
  assert.match(script, /THEPAYONE_PACKAGE_TERMINAL_ID THEPAYONE_PACKAGE_PAY_KEY/);
});
