import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite";
it("keeps reports private, idempotent and indexed", async () => {
  const db = new PGlite();
  await db.exec(
    `create schema shorts_mvp;create role anon;create role authenticated;create role service_role;create table shorts_mvp.app_users(id uuid primary key);`,
  );
  await db.exec(
    readFileSync(
      new URL(
        "../../supabase/migrations/20261116032204_ranking_traffic_observability.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const id = crypto.randomUUID();
  const sql = `insert into shorts_mvp.media_traffic_events(id,resource,provider,purpose,measurement,bytes,environment) values('${id}','test','vercel_sandbox','source_preview','server_write',1024,'candidate') on conflict(id) do nothing`;
  await db.exec(sql);
  await db.exec(sql);
  expect(
    (
      await db.query(
        "select sum(bytes)::int as bytes,count(*)::int as count from shorts_mvp.media_traffic_events",
      )
    ).rows,
  ).toEqual([{ bytes: 1024, count: 1 }]);
  await db.exec("grant usage on schema shorts_mvp to anon;set role anon");
  await expect(
    db.query("select * from shorts_mvp.media_traffic_events"),
  ).rejects.toThrow();
  await db.close();
});
