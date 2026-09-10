import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { withReadRequest } from "./read-request";

const connection = process.env.READ_REQUEST_TEST_DATABASE_URL;
if (connection && !["localhost", "127.0.0.1"].includes(new URL(connection).hostname)) {
  throw new Error("Read request integration tests require a local PostgreSQL database");
}

describe.skipIf(!connection)("read request PostgreSQL integration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("enforces transaction-local limits while allowing existing read locks", async () => {
    vi.stubEnv("DATABASE_URL", connection!);
    await withReadRequest("integration_limits", async () => {
      const rows = await getDb()`select current_setting('statement_timeout') as statement_timeout,
        current_setting('lock_timeout') as lock_timeout, current_setting('transaction_read_only') as read_only`;
      expect(rows[0]).toMatchObject({ statementTimeout: "4s", lockTimeout: "1s", readOnly: "off" });
    });

  });

  it("cancels a slow SQL statement and successfully serves the following request", async () => {
    vi.stubEnv("DATABASE_URL", connection!);
    const start = Date.now();
    await expect(withReadRequest("integration_sql_timeout", async () => {
      await getDb()`select pg_sleep(6)`;
    })).rejects.toMatchObject({ code: "READ_REQUEST_UNAVAILABLE" });
    expect(Date.now() - start).toBeLessThan(6_000);
    await expect(withReadRequest("integration_recovery", async () => {
      const rows = await getDb()`select 42 as answer`;
      return rows[0].answer;
    })).resolves.toBe(42);
  }, 10_000);

  it("closes an in-flight transaction when the browser aborts", async () => {
    vi.stubEnv("DATABASE_URL", connection!);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      const start = Date.now();
      await expect(withReadRequest("integration_abort", async () => {
        await getDb()`select pg_sleep(6)`;
      }, controller.signal)).rejects.toMatchObject({ code: "READ_REQUEST_ABORTED" });
      expect(Date.now() - start).toBeLessThan(2_000);
    } finally {
      clearTimeout(timer);
    }
  });
});
