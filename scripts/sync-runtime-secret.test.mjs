import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkerDatabaseUrl } from "./sync-runtime-secret.mjs";

test("removes client-only Supabase URL options for psycopg", () => {
  const normalized = new URL(normalizeWorkerDatabaseUrl(
    "postgresql://user:pass@example.com:5432/db?pgbouncer=true&sslmode=require&connection_limit=1&schema=shorts_mvp",
  ));

  assert.equal(normalized.searchParams.get("sslmode"), "require");
  assert.equal(normalized.searchParams.has("pgbouncer"), false);
  assert.equal(normalized.searchParams.has("connection_limit"), false);
  assert.equal(normalized.searchParams.has("schema"), false);
});

test("keeps a direct PostgreSQL URL unchanged", () => {
  const value = "postgresql://user:pass@example.com:5432/db?sslmode=require";
  assert.equal(normalizeWorkerDatabaseUrl(value), value);
});
