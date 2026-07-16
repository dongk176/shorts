import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(new URL("./sync-vercel-env.sh", import.meta.url), "utf8");

test("syncs the server-side Supabase Auth configuration to Vercel", () => {
  assert.match(script, /for name in[^\n]*DATABASE_URL SUPABASE_URL SUPABASE_PUBLISHABLE_KEY/);
});
