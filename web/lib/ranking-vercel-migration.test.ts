import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
it("isolates Vercel jobs from legacy workers without changing old jobs", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create schema shorts_mvp; create table shorts_mvp.app_users(id uuid primary key,is_admin boolean,email text);",
    );
    await db.exec(
      await readFile(
        "../supabase/migrations/20261024081212_ranking_shorts_admin.sql",
        "utf8",
      ),
    );
    const owner = randomUUID(),
      project = randomUUID(),
      old = randomUUID(),
      current = randomUUID();
    await db.query("insert into shorts_mvp.app_users values($1,true,$2)", [
      owner,
      "test@example.test",
    ]);
    await db.query(
      "insert into shorts_mvp.ranking_projects(id,user_id) values($1,$2)",
      [project, owner],
    );
    await db.query(
      "insert into shorts_mvp.ranking_operations(id,project_id,action,request_id) values($1,$2,'render',$3)",
      [old, project, randomUUID()],
    );
    await db.exec(
      await readFile(
        "../supabase/migrations/20261025081932_ranking_vercel_sessions.sql",
        "utf8",
      ),
    );
    await db.query(
      "update shorts_mvp.ranking_operations set status='succeeded' where id=$1",
      [old],
    );
    await db.query(
      "insert into shorts_mvp.ranking_operations(id,project_id,action,request_id,executor,status) values($1,$2,'render',$3,'vercel','running')",
      [current, project, randomUUID()],
    );
    await db.exec("set role shorts_ranking_runtime");
    expect(
      (
        await db.query(
          "select id from shorts_ranking_runtime.ranking_operations",
        )
      ).rows,
    ).toEqual([{ id: old }]);
    expect(
      (
        await db.query(
          "update shorts_ranking_runtime.ranking_operations set status='failed' where status='running' returning id",
        )
      ).rows,
    ).toEqual([]);
    await db.exec("reset role");
    expect(
      (
        await db.query(
          "select status from shorts_mvp.ranking_operations where id=$1",
          [current],
        )
      ).rows,
    ).toEqual([{ status: "running" }]);
    expect(
      (
        await db.query(
          "select has_table_privilege('anon','shorts_mvp.ranking_vercel_sessions','select') as allowed",
        )
      ).rows,
    ).toEqual([{ allowed: false }]);
  } finally {
    await db.close();
  }
});
