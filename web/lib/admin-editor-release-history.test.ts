import { readFileSync } from "node:fs";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { expect, it } from "vitest";

it("keeps selected releases and their checks visible beyond the latest thirty", async () => {
  const source = readFileSync(new URL("../app/admin/easycutcutcutcutcutcut/page.tsx", import.meta.url), "utf8");
  const queries = [...source.matchAll(/with visible_editor_releases as \(([\s\S]*?)\n          \)/g)];
  expect(queries).toHaveLength(2);
  const db = new PGlite();
  try {
    await db.exec(`create schema shorts_mvp;
      create table shorts_mvp.editor_releases(id int primary key,created_at int);
      create table shorts_mvp.editor_release_state(singleton boolean,stable_release_id int,candidate_release_id int,previous_stable_release_id int);
      insert into shorts_mvp.editor_releases select n,n from generate_series(1,40) n;
      insert into shorts_mvp.editor_release_state values(true,1,2,3);`);
    for (const [, selection] of queries) {
      const { rows } = await db.query<{ id: number }>(`with visible_editor_releases as (${selection}) select id from visible_editor_releases order by id`);
      expect(rows.map(row => row.id)).toEqual([1, 2, 3, ...Array.from({ length: 30 }, (_, i) => i + 11)]);
    }
    await db.exec("update shorts_mvp.editor_release_state set candidate_release_id=40,previous_stable_release_id=null");
    const { rows } = await db.query<{ id: number }>(`select id from shorts_mvp.editor_releases where id in (${queries[0][1]}) order by id`);
    expect(rows.map(row => row.id)).toEqual([1, ...Array.from({ length: 30 }, (_, i) => i + 11)]);
  } finally { await db.close(); }
});
