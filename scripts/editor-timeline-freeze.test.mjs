import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../test-tools/node_modules/@electric-sql/pglite/dist/index.js';
test('capture freezes only while editor uses clean clip, including old workers', async () => {
 const db = new PGlite();
 try {
  await db.exec(`create schema shorts_mvp; create table shorts_mvp.generated_shorts (id int primary key, status text, edit_timeline_s3_key text);`);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261013195439_freeze_editor_timeline_during_render.sql',import.meta.url),'utf8'));
  await db.exec(`insert into shorts_mvp.generated_shorts values (1,'rerendering',null),(2,'ready',null),(3,'rerendering',null),(4,'rerendering','existing');`);
  assert.equal((await db.query(`update shorts_mvp.generated_shorts set edit_timeline_s3_key='capture' where id=1 returning *`)).rows.length,0);
  assert.equal((await db.query(`update shorts_mvp.generated_shorts set edit_timeline_s3_key='capture' where id=2 returning *`)).rows.length,1);
  assert.equal((await db.query(`update shorts_mvp.generated_shorts set status='ready',edit_timeline_s3_key='render' where id=3 returning *`)).rows.length,1);
  assert.equal((await db.query(`update shorts_mvp.generated_shorts set status='failed' where id=1 returning *`)).rows.length,1);
  assert.equal((await db.query(`update shorts_mvp.generated_shorts set edit_timeline_s3_key='replacement' where id=4 returning *`)).rows.length,1);
 } finally { await db.close(); }
});
