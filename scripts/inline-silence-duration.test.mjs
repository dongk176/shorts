import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {PGlite} from "../test-tools/node_modules/@electric-sql/pglite/dist/index.js";

test("initial silence output respects the production range constraint and retains original bounds", async()=>{
 const queries=JSON.parse(execFileSync("python3",["-c",`import ast,json
m=ast.parse(open("worker/shorts_worker/repository.py").read())
f=next(n for n in ast.walk(m) if isinstance(n,ast.FunctionDef) and n.name=="complete_initial_render")
print(json.dumps([n.value for n in ast.walk(f) if isinstance(n,ast.Constant) and isinstance(n.value,str) and "set editor_document=%s" in n.value]))`],{encoding:"utf8"}));
 assert.equal(queries.length,1);
 let i=0; const sql=queries[0].replaceAll("%s",()=>`$${++i}`);
 const db=new PGlite();
 try {
  await db.exec(`create schema shorts_mvp;
   create table shorts_mvp.generated_shorts(id int primary key,editor_document jsonb,editor_document_version int,
    start_seconds numeric,end_seconds numeric,duration_seconds numeric,initial_start_seconds numeric,initial_end_seconds numeric,
    constraint generated_shorts_duration_range_check check(duration_seconds>=1 and end_seconds>start_seconds and duration_seconds=end_seconds-start_seconds));
   insert into shorts_mvp.generated_shorts(id,start_seconds,end_seconds,duration_seconds) values(1,84.310,115.850,31.540);`);
  await db.query(sql,[{version:3},28.667,28.667,1]);
  assert.deepEqual((await db.query("select start_seconds,end_seconds,duration_seconds,initial_start_seconds,initial_end_seconds from shorts_mvp.generated_shorts")).rows,
   [{start_seconds:"84.310",end_seconds:"112.977",duration_seconds:"28.667",initial_start_seconds:"84.310",initial_end_seconds:"115.850"}]);
  // Repeated saves retain original source bounds rather than shortening them.
  await db.query(sql,[{version:3},25,25,1]);
  assert.equal((await db.query("select initial_end_seconds from shorts_mvp.generated_shorts")).rows[0].initial_end_seconds,"115.850");
 } finally {await db.close();}
});
