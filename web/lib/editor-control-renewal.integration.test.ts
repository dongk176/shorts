import { readFile } from 'node:fs/promises';
import { PGlite } from '../../test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
let db: PGlite;
const lease = '11111111-1111-4111-8111-111111111111';
const acquire = `update shorts_mvp.editor_release_state set control_renewal_lease_id='${lease}',control_renewal_lease_owner='stage-b:renewal:${'a'.repeat(40)}',control_renewal_lease_expires_at=now()+interval '1 hour'`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema shorts_mvp;
    create table shorts_mvp.editor_release_state(singleton boolean primary key,stable_release_id uuid,
    render_v4_infra_lease_id uuid,render_v4_infra_lease_expires_at timestamptz,
    render_v4_target_successor jsonb,render_v4_kill_switch boolean default false);
    insert into shorts_mvp.editor_release_state(singleton) values(true)`);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261106185344_editor_control_renewal_lease.sql',import.meta.url),'utf8'));
});
beforeEach(async()=>{
  await db.exec(`update shorts_mvp.editor_release_state set control_renewal_lease_id=null,control_renewal_lease_owner=null,control_renewal_lease_expires_at=null,
    render_v4_infra_lease_id=null,render_v4_infra_lease_expires_at=null,render_v4_target_successor=null,render_v4_kill_switch=false`);
});
afterAll(async()=>{ await db.close(); });
it('control renewal leaves the admission fence unset and emergency kill available', async()=>{
  await db.exec(acquire);
  await db.exec('update shorts_mvp.editor_release_state set render_v4_kill_switch=true');
  expect((await db.query('select render_v4_infra_lease_id,render_v4_kill_switch from shorts_mvp.editor_release_state')).rows[0])
    .toEqual({render_v4_infra_lease_id:null,render_v4_kill_switch:true});
});
it('old infrastructure controllers cannot acquire a fence during renewal',async()=>{
  await db.exec(acquire);
  await expect(db.exec(`update shorts_mvp.editor_release_state set render_v4_infra_lease_id='${lease}',render_v4_infra_lease_expires_at=now()+interval '1 hour'`)).rejects.toThrow('CONFLICTING');
});
it('renewal cannot start over an infrastructure fence',async()=>{
  await db.exec(`update shorts_mvp.editor_release_state set render_v4_infra_lease_id='${lease}',render_v4_infra_lease_expires_at=now()+interval '1 hour'`);
  await expect(db.exec(acquire)).rejects.toThrow('CONFLICTING');
});
it('successor rotation and stable promotion remain blocked while renewal runs',async()=>{
  await db.exec(acquire);
  await expect(db.exec(`update shorts_mvp.editor_release_state set render_v4_target_successor='{"phase":"fenced"}'`)).rejects.toThrow('CONFLICTING');
  await expect(db.exec(`update shorts_mvp.editor_release_state set stable_release_id='${lease}'`)).rejects.toThrow('STABLE_POINTER');
});
it('expiry permits legacy infrastructure operations again',async()=>{
  await db.exec(acquire);
  await db.exec(`update shorts_mvp.editor_release_state set control_renewal_lease_expires_at=now()-interval '1 second'`);
  await db.exec(`update shorts_mvp.editor_release_state set render_v4_infra_lease_id='${lease}',render_v4_infra_lease_expires_at=now()+interval '1 hour'`);
});
it('null or non-renewal owner cannot satisfy the identity constraint',async()=>{
  await expect(db.exec(`update shorts_mvp.editor_release_state set control_renewal_lease_id='${lease}',control_renewal_lease_expires_at=now()+interval '1 hour'`)).rejects.toThrow();
});
