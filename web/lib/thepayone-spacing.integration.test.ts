import { expect, it } from "vitest";
import postgres from "postgres";
import { withThePayOneSpacing } from "./thepayone-spacing";

// Explicit opt-in: advisory locks only, no schema/business writes and NO HTTP
// requests to the payment provider. Every call opens an independent connection.
it.skipIf(process.env.THEPAYONE_SPACING_DB_TEST !== "1")(
  "serializes independent DB connections and preserves spacing after a failure",
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(`${url.hostname}/${url.username}`).toContain("mvcprswvfybudtopepuj");
    const db = postgres(url.toString(), { max: 1, prepare: false, connect_timeout: 5 });
    try {
      const [identity] = await db`select current_database() as name,
        to_regnamespace('shorts_mvp')::text as schema,
        has_function_privilege('pg_catalog.pg_advisory_xact_lock(integer,integer)', 'EXECUTE') as allowed`;
      expect(identity).toMatchObject({ name: "postgres", schema: "shorts_mvp", allowed: true });
    } finally { await db.end({ timeout: 1 }); }

    const events: Array<{ start: number; end: number }> = [];
    const failure = new Error("synthetic provider rejection");
    const results = await Promise.allSettled([0, 1, 2].map((index) => withThePayOneSpacing(async () => {
      const event = { start: performance.now(), end: 0 };
      events.push(event);
      await new Promise((resolve) => setTimeout(resolve, 150));
      event.end = performance.now();
      if (index === 1) throw failure;
      return index;
    })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(results[1]).toMatchObject({ status: "rejected", reason: failure });
    expect(events).toHaveLength(3);
    const gaps = events.slice(1).map((event, index) => event.start - events[index].end);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(3000);
    console.info("Independent connection response-to-next-request gaps (ms):", gaps.map(Math.round));
  },
  40_000,
);
