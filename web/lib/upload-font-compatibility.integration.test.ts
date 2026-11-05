import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '../../test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { afterAll,beforeAll,expect,it } from 'vitest';
let db:PGlite;
const admin='11111111-1111-4111-8111-111111111111', release='22222222-2222-4222-8222-222222222222',probe='33333333-3333-4333-8333-333333333333';
const old={fallbackDetected:false,entries:[{fontId:'original',sha256:'old-face',metrics:{width:123}}]};
const next={...old,entries:[...old.entries,{fontId:'noto-sans-jp',sha256:'new-face',metrics:{width:234}}]};
const canonical=(v:unknown)=>JSON.stringify(v),hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema shorts_mvp;
 create table shorts_mvp.app_users(id uuid primary key,is_admin boolean,withdrawn_at timestamptz);
 create table shorts_mvp.editor_releases(id uuid primary key,font_manifest_sha256 text,staging_verified_at timestamptz,render_spec_version int,caption_render_spec_version int,git_sha text,worker_image_digest text);
 create table shorts_mvp.editor_release_probe_runs(id uuid primary key,finalized_release_id uuid,state text,git_sha text,worker_image_digest text,font_manifest_sha256 text,artifact_uri text,manifest_s3_version_id text);
 create function shorts_mvp._verified_file_upload_successor_identity(r uuid,p_font_manifest_sha256 text) returns jsonb language sql as $$ select to_jsonb(release) from shorts_mvp.editor_releases release where release.id=r and release.font_manifest_sha256=p_font_manifest_sha256 $$;
 insert into shorts_mvp.app_users values('${admin}',true,null);
 insert into shorts_mvp.editor_releases values('${release}','${hash(next)}',now(),4,4,'source','digest');
 insert into shorts_mvp.editor_release_probe_runs values('${probe}','${release}','finalized','source','digest','${hash(next)}','s3://evidence/probe','version');`);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261105190511_additive_upload_font_compatibility.sql',import.meta.url),'utf8'));
});
afterAll(async()=>{await db?.close();});
it('accepts exactly one JP addition and rejects changed or missing old faces, metadata and duplicates',async()=>{
 const check=async(a:unknown,b:unknown)=>(await db.query<{ok:boolean}>('select shorts_mvp.is_additive_japanese_font_manifest($1,$2) ok',[canonical(a),canonical(b)])).rows[0].ok;
 expect(await check(old,next)).toBe(true);
 for(const value of [old,{...next,fallbackDetected:true},{...next,entries:[{...old.entries[0],sha256:'changed'},next.entries[1]]},{...next,entries:[next.entries[1]]},{...next,entries:[...next.entries,{fontId:'another'}]},{...next,entries:[old.entries[0],old.entries[0]]},{...next,entries:[{...old.entries[0],metrics:{width:124}},next.entries[1]]}])expect(await check(old,value)).toBe(false);
 expect((await db.query<{ok:boolean}>("select shorts_mvp.is_additive_japanese_font_manifest('invalid','{}') ok")).rows[0].ok).toBe(false);
});
it('requires attested hashes, owner and probe, preserves exact matching and immutable proof',async()=>{
 const insert=(overrides:Record<string,unknown>={})=>{
 const v={release_id:release,previous_manifest_sha256:hash(old),next_manifest_sha256:hash(next),previous_manifest_canonical:canonical(old),next_manifest_canonical:canonical(next),probe_run_id:probe,evidence_uri:'s3://evidence/probe',evidence_version_id:'version',recorded_by:admin,...overrides};const names=Object.keys(v);
 return db.query(`insert into shorts_mvp.upload_font_compatibility(${names.join(',')}) values(${names.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(v));};
 const resolve=async(font:string)=>(await db.query<{proof:unknown}>('select shorts_mvp._verified_file_upload_successor_identity($1,$2) proof',[release,font])).rows[0].proof;
 expect(await resolve(hash(next))).not.toBeNull();expect(await resolve(hash(old))).toBeNull();
 await expect(insert({previous_manifest_sha256:'0'.repeat(64)})).rejects.toThrow();
 await expect(insert({evidence_version_id:'wrong'})).rejects.toThrow('UPLOAD_FONT_PROOF_NOT_ATTESTED');
 await db.exec('update shorts_mvp.app_users set is_admin=false');await expect(insert()).rejects.toThrow('UPLOAD_FONT_PROOF_NOT_ATTESTED');await db.exec('update shorts_mvp.app_users set is_admin=true');
 await db.exec("update shorts_mvp.editor_release_probe_runs set state='pending'");await expect(insert()).rejects.toThrow('UPLOAD_FONT_PROOF_NOT_ATTESTED');await db.exec("update shorts_mvp.editor_release_probe_runs set state='finalized'");
 await insert();expect(await resolve(hash(old))).not.toBeNull();expect(await resolve('0'.repeat(64))).toBeNull();
 await expect(db.exec('delete from shorts_mvp.upload_font_compatibility')).rejects.toThrow('UPLOAD_FONT_PROOF_IMMUTABLE');
 await expect(db.exec("update shorts_mvp.upload_font_compatibility set evidence_version_id='new'")).rejects.toThrow('UPLOAD_FONT_PROOF_IMMUTABLE');
});
