import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeRuntimeSecretValues,
  normalizeWorkerDatabaseUrl,
  runtimeSecretNames,
} from "./sync-runtime-secret.mjs";

test("preserves the externally imported proxy pool when local env omits it", () => {
  const values = mergeRuntimeSecretValues(
    { INGESTION_PROXY_ROUTES_JSON: "secret-routes", OPENAI_API_KEY: "old-key" },
    { OPENAI_API_KEY: "new-key" },
  );

  assert.equal(values.INGESTION_PROXY_ROUTES_JSON, "secret-routes");
  assert.equal(values.OPENAI_API_KEY, "new-key");
});

test("includes the legacy and four named WARP configurations", () => {
  assert.deepEqual(
    runtimeSecretNames.filter((name) => name.startsWith("WARP_CONF_")),
    [
      "WARP_CONF_B64",
      "WARP_CONF_A_B64",
      "WARP_CONF_B_B64",
      "WARP_CONF_C_B64",
      "WARP_CONF_D_B64",
    ],
  );
});

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
