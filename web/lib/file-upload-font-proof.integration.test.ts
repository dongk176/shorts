import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

let db: PGlite;
const oldId="11111111-1111-4111-8111-111111111111", nextId="22222222-2222-4222-8222-222222222222";
const admin="33333333-3333-4333-8333-333333333333";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
const face={fontId:"existing",sha256:"a".repeat(64),cssToAssScale:0.9,titleBaselineOffsetEm:0.3};
let oldText:string,newText:string;
const manifest=(font:string,entries:unknown[])=>JSON.stringify({gitSha:"b".repeat(40),workerImageDigest:`sha256:${"c".repeat(64)}`,
 fontManifestSha256:font,fontManifest:{sha256:font,fallbackDetected:false,entries}});
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema shorts_mvp;
 create table shorts_mvp.app_users(id uuid primary key,is_admin boolean);
 create table shorts_mvp.editor_releases(id uuid primary key,font_manifest_sha256 text,capability boolean default true);
 create table shorts_mvp.editor_release_probe_runs(id uuid primary key,finalized_release_id uuid,state text,
 manifest_sha256 text,manifest_s3_version_id text,git_sha text,worker_image_digest text,font_manifest_sha256 text);
 create table shorts_mvp.file_upload_release_checks(check_key text primary key,passed boolean,details jsonb);
 insert into shorts_mvp.app_users values('${admin}',true);
 create function shorts_mvp._verified_file_upload_successor_identity(p_id uuid,p_font text) returns jsonb
 language plpgsql as $$begin
 if not exists(select 1 from shorts_mvp.editor_releases where id=p_id and font_manifest_sha256=p_font and capability)
 then raise exception 'original capability rejected';end if;
 return jsonb_build_object('releaseId',p_id,'fontManifestSha256',p_font);end;$$;`);
 await db.exec(await readFile(new URL("../../supabase/migrations/20261106154300_upload_additive_font_proof.sql",import.meta.url),"utf8"));
});
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 oldText=manifest("d".repeat(64),[face]);newText=manifest("e".repeat(64),[face,{...face,fontId:"noto-sans-jp",sha256:"f".repeat(64)}]);
 await db.exec("delete from shorts_mvp.file_upload_font_successor_proofs;delete from shorts_mvp.editor_release_probe_runs;delete from shorts_mvp.editor_releases;delete from shorts_mvp.file_upload_release_checks");
 for(const [id,text,font] of [[oldId,oldText,"d".repeat(64)],[nextId,newText,"e".repeat(64)]]){
  await db.query("insert into shorts_mvp.editor_releases values($1,$2,true)",[id,font]);
  await db.query("insert into shorts_mvp.editor_release_probe_runs values($1,$1,'finalized',$2,'versioned',$3,$4,$5)",[id,digest(text),"b".repeat(40),`sha256:${"c".repeat(64)}`,font]);
 }
 await db.query("insert into shorts_mvp.file_upload_release_checks values('runtime_identity',true,$1::jsonb)",[JSON.stringify({releaseId:oldId,fontManifestSha256:"d".repeat(64)})]);
});
const record=()=>db.query("select shorts_mvp.record_file_upload_font_successor_proof($1,$2,$3,$4,$5)",[oldId,nextId,oldText,newText,admin]);
const verify=()=>db.query("select shorts_mvp._verified_file_upload_successor_identity($1,$2) as identity",[nextId,"d".repeat(64)]);
const attestChangedManifest=()=>db.query("update shorts_mvp.editor_release_probe_runs set manifest_sha256=$1 where id=$2",[digest(newText),nextId]);
it("requires artifact proof before allowing an additive manifest and retains original capability checks",async()=>{
 await expect(verify()).rejects.toThrow("additive font proof required");
 await record();expect((await verify()).rows).toEqual([{identity:{releaseId:nextId,fontManifestSha256:"e".repeat(64)}}]);
 await db.query("update shorts_mvp.editor_releases set capability=false where id=$1",[nextId]);
 await expect(verify()).rejects.toThrow("original capability rejected");
});
it("rejects fabricated or edited artifact contents",async()=>{
 newText+=" ";await expect(record()).rejects.toThrow("does not match finalized artifacts");
});
it.each(["sha256","cssToAssScale","titleBaselineOffsetEm"])("rejects a finalized artifact changing an existing %s",async field=>{
 const doc=JSON.parse(newText);doc.fontManifest.entries[0][field]=field==="sha256"?"0".repeat(64):1;
 newText=JSON.stringify(doc);await attestChangedManifest();await expect(record()).rejects.toThrow("bytes or metrics changed");
});
it("rejects duplicate font ids and missing old fonts",async()=>{
 newText=manifest("e".repeat(64),[face,face]);await attestChangedManifest();await expect(record()).rejects.toThrow("bytes or metrics changed");
 newText=manifest("e".repeat(64),[{...face,fontId:"other"},{...face,fontId:"new"}]);await attestChangedManifest();await expect(record()).rejects.toThrow("bytes or metrics changed");
});
it("rejects fallback fonts or mixed source identity even with matching artifact hash",async()=>{
 const doc=JSON.parse(newText);doc.fontManifest.fallbackDetected=true;newText=JSON.stringify(doc);await attestChangedManifest();
 await expect(record()).rejects.toThrow("identity mismatch");
 doc.fontManifest.fallbackDetected=false;doc.gitSha="0".repeat(40);newText=JSON.stringify(doc);await attestChangedManifest();
 await expect(record()).rejects.toThrow("identity mismatch");
});
it("rejects stale evidence after finalized probe or current runtime changes",async()=>{
 await record();await db.query("update shorts_mvp.editor_release_probe_runs set manifest_sha256=$1 where id=$2",["0".repeat(64),nextId]);
 await expect(verify()).rejects.toThrow("additive font proof required");
 await attestChangedManifest();await db.exec("update shorts_mvp.file_upload_release_checks set details='{}'");
 await expect(verify()).rejects.toThrow("additive font proof required");
});
it("keeps the unchanged-font path and denies clients mutable proof access",async()=>{
 expect((await db.query("select shorts_mvp._verified_file_upload_successor_identity($1,$2) as identity",[oldId,"d".repeat(64)])).rows).toHaveLength(1);
 for(const role of ["anon","authenticated","service_role"]){
  await db.exec(`set role ${role}`);
  await expect(db.exec("delete from shorts_mvp.file_upload_font_successor_proofs")).rejects.toThrow();
  if(role!=="service_role")await expect(record()).rejects.toThrow();
  await db.exec("reset role");
 }
});
