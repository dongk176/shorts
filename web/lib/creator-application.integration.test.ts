import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CREATOR_APPLICATION_TERMS_VERSION, type CreatorApplication } from "./creator-application";
const context = vi.hoisted(() => ({ db: null as unknown as Sql, authId: null as string | null }));
vi.mock("@/lib/db", () => ({ getDb: () => context.db }));
vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedUser: async () => context.authId ? { id: context.authId } : null }));
import { GET, POST } from "@/app/api/creator-support/application/route";
import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/creator-support/applications/route";
import { POST as oldEnrollPOST } from "@/app/api/creator-support/enroll/route";
import { maintainCreatorApplications } from "./creator-application-server";
import { getUsageSnapshot } from "./usage";
const connection = process.env.CREATOR_APPLICATION_TEST_DATABASE_URL;
if (connection) { const url = new URL(connection); if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/creator_application_test") throw new Error("Requires isolated localhost/creator_application_test"); }
const migration = (name: string) => readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8");
const request = (route: string, body: unknown, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) });
let db: Sql; let user: { id: string; auth: string }; let admin: { id: string; auth: string };
async function account(isAdmin = false) { const id = randomUUID(); const auth = randomUUID(); await db`insert into shorts_mvp.app_users(id,auth_user_id,display_name,email,provider,is_admin) values(${id},${auth},'크리에이터',null,'kakao',${isAdmin})`; return { id, auth }; }
async function payload(name = "creator") {
  const me = await (await GET()).json();
  return { accountKey: me.account.key, requestId: randomUUID(), channels: [{ platform: "youtube", channelUrl: `https://youtube.com/@${name}` },{ platform: "instagram", channelUrl: `https://instagram.com/${name}` }], phoneNumber: "01000000000", ownsChannel: true, termsVersion: CREATOR_APPLICATION_TERMS_VERSION, consents: { collection: true, disclosure: true, license: true } };
}
async function apply(name = "creator") { const response = await POST(request("creator-support/application", await payload(name))); const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body.application as CreatorApplication; }
async function select(id: string) { context.authId = admin.auth; return adminPOST(request("admin/creator-support/applications", { action: "select", id, reference: "LOCAL TEST selection", confirmed: true })); }
describe.skipIf(!connection)("creator application PostgreSQL and authenticated API", () => {
  beforeAll(async () => {
    db = postgres(connection!, { max: 12, prepare: false, transform: postgres.camel, onnotice: () => undefined }); context.db = db;
    await db.unsafe(`
      drop schema if exists shorts_mvp cascade;
      create schema shorts_mvp;
      do $$ begin
        if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
        if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
      end $$;
      grant usage on schema shorts_mvp to anon,authenticated,service_role;
      create table shorts_mvp.app_users (
        id uuid primary key,auth_user_id uuid unique,email text,display_name text,provider text,
        created_at timestamptz default now(),withdrawn_at timestamptz,manual_service_access_until timestamptz,is_admin boolean default false
      );
      create table shorts_mvp.user_subscriptions (
        id uuid primary key default gen_random_uuid(),user_id uuid,status text,current_period_start timestamptz,current_period_end timestamptz,next_quota_at timestamptz
      );
      create table shorts_mvp.billing_orders(id uuid primary key default gen_random_uuid());
      create table shorts_mvp.usage_reservations (
        id uuid primary key default gen_random_uuid(),user_id uuid,source_duration_seconds integer,status text
      );
      create table shorts_mvp.enterprise_service_entitlements(app_user_id uuid,starts_at timestamptz,ends_at timestamptz);
      alter table shorts_mvp.enterprise_service_entitlements add column usage_grant_id uuid,add column payment_item_id uuid;
      create table shorts_mvp.enterprise_payment_items(id uuid,name text);
      create table shorts_mvp.video_jobs(id uuid,project_number bigint,video_title text,status text);
      create table shorts_mvp.usage_events(id uuid,occurred_at timestamptz,event_type text,source_duration_seconds integer,user_id uuid,job_id uuid);
      alter table shorts_mvp.app_users add column default_payment_method_id uuid;
      alter table shorts_mvp.billing_orders add column user_id uuid,add column status text,add column amount_krw integer,
        add column product_code text,add column billing_cycle text,add column approved_at timestamptz,
        add column created_at timestamptz default now(),add column checkout_expires_at timestamptz,add column kind text;
      create table shorts_mvp.billing_payment_methods(id uuid,user_id uuid,status text,provider text,issuer_name text,issuer_code text,
        card_number_masked text,card_last4 text,payer_tel_ciphertext text,payer_tel_iv text,payer_tel_tag text);
      create table shorts_mvp.managed_login_accounts(app_user_id uuid,is_active boolean,max_active_jobs integer);
      create table shorts_mvp.plans(code text,display_name text,monthly_source_seconds integer,max_active_jobs integer,retention_days integer);
      alter table shorts_mvp.user_subscriptions add column plan_code text,add column billing_cycle text,
        add column next_retry_at timestamptz,add column next_charge_at timestamptz,add column cancel_at_period_end boolean,
        add column scheduled_plan_code text,add column scheduled_billing_cycle text,add column payment_provider text,
        add column provider_schedule_status text,add column billing_review_status text,add column payment_method_id uuid,
        add column created_at timestamptz default now();
    `);
    const baseline = migration("202607180001_billing_and_usage_grants.sql");
    await db.unsafe(baseline.slice(baseline.indexOf("create table if not exists shorts_mvp.usage_grants ("), baseline.indexOf("alter table shorts_mvp.video_jobs")));
    await db.unsafe("alter table shorts_mvp.usage_grants add column credited_seconds integer not null default 0, add column carried_seconds integer not null default 0");
    await db.unsafe(baseline.slice(baseline.indexOf("create or replace function shorts_mvp.apply_usage_reservation_transition()"), baseline.indexOf("for each row execute function shorts_mvp.apply_usage_reservation_transition();") + "for each row execute function shorts_mvp.apply_usage_reservation_transition();".length));
    const funding = migration("202607290001_paid_usage_before_complimentary.sql");
    await db.unsafe(funding.slice(funding.indexOf("alter table shorts_mvp.usage_grants"), funding.indexOf("create or replace function")));
    const migrationConnection = await db.reserve();
    try {
      await migrationConnection.unsafe(migration("202609110004_creator_support.sql"));
      await migrationConnection.unsafe(migration("202609110005_creator_support_usage.sql"));
      await migrationConnection.unsafe(migration("202609110006_creator_applications.sql"));
    } finally { migrationConnection.release(); }
  }, 30_000);
  beforeEach(async () => {
    await db`truncate shorts_mvp.app_users,shorts_mvp.billing_orders,shorts_mvp.user_subscriptions,shorts_mvp.usage_reservations cascade`;
    await db`insert into shorts_mvp.creator_support_programs(code,terms_version,enrollment_open,legal_review_version,legal_review_reference,legal_reviewed_at)
      values('creator_support_2026_v1',${CREATOR_APPLICATION_TERMS_VERSION},true,${CREATOR_APPLICATION_TERMS_VERSION},'LOCAL TEST ONLY',clock_timestamp())`;
    user = await account(); admin = await account(true); context.authId = user.auth;
  });
  afterAll(async () => { if (db) await db.end(); });
  it("saves both links and phone without granting usage; survives reread", async () => {
    const app = await apply(); expect(app).toMatchObject({ state: "pending_review", phoneNumber: "010-0000-0000", enrollmentId: null }); expect(app.channels).toHaveLength(2);
    expect((await db`select count(*)::int as n from shorts_mvp.usage_grants`)[0].n).toBe(0);
    expect((await (await GET()).json()).application.id).toBe(app.id);
    context.authId = admin.auth; const response = await adminGET(new Request("http://localhost:3000/api/admin/creator-support/applications"));
    expect(response.headers.get("cache-control")).toContain("no-store"); const body = await response.json(); expect(body.items[0]).toMatchObject({ id: app.id, phoneNumber: app.phoneNumber }); expect(body.items[0].channels).toHaveLength(2);
  });
  it("requires session, current account, same origin, all consents and rejects arbitrary recipients", async () => {
    const body = await payload(); context.authId = null;
    expect((await POST(request("creator-support/application",body))).status).toBe(401);
    context.authId = user.auth;
    expect((await POST(request("creator-support/application",body,"https://evil.example"))).status).toBe(403);
    expect((await POST(request("creator-support/application",{...body,accountKey:'a'.repeat(64)}))).status).toBe(409);
    expect((await POST(request("creator-support/application",{...body,userId:admin.id}))).status).toBe(400);
    expect((await POST(request("creator-support/application",{...body,consents:{...body.consents,license:false}}))).status).toBe(400);
    expect((await adminGET(new Request("http://localhost:3000/api/admin/creator-support/applications"))).status).toBe(403);
    const app=await apply(); const other=await account(); context.authId=other.auth; expect((await (await GET()).json()).application).toBeNull();
    expect((await adminGET(new Request(`http://localhost:3000/api/admin/creator-support/applications?id=${app.id}`))).status).toBe(403);
  });
  it("deduplicates concurrent submissions and rolls back both links on a conflict", async () => {
    const body=await payload(); const results=await Promise.all(Array.from({length:6},()=>POST(request("creator-support/application",body))));
    expect(results.every(r=>r.status===200)).toBe(true); expect((await db`select count(*)::int as n from shorts_mvp.creator_support_applications`)[0].n).toBe(1);
    const other=await account(); context.authId=other.auth; const duplicate=await payload("othercreator"); duplicate.channels[1].channelUrl='https://instagram.com/creator';
    expect((await POST(request("creator-support/application",duplicate))).status).toBe(409);
    expect((await db`select count(*)::int as n from shorts_mvp.creator_support_applications where user_id=${other.id}`)[0].n).toBe(0);
  });
  it("grants 100 minutes on selection only, once, and makes only the first installment available", async () => {
    const app=await apply(); const responses=await Promise.all(Array.from({length:5},()=>select(app.id))); expect(responses.every(r=>r.status===200),JSON.stringify(await Promise.all(responses.map(r=>r.json())))).toBe(true);
    const grants=await db`select * from shorts_mvp.usage_grants where user_id=${user.id} order by valid_from`; expect(grants).toHaveLength(3);
    expect(grants.every(g=>g.totalSeconds===6000 && g.productCode==='creator_support_100min_v2')).toBe(true);
    expect((await db`select count(*)::int as n from shorts_mvp.usage_grants where valid_from<=clock_timestamp() and expires_at>clock_timestamp()`)[0].n).toBe(1);
    context.authId=user.auth; const me=await (await GET()).json(); expect(me.application.state).toBe('selected'); expect(me.status.installments[0].remainingSeconds).toBe(6000);
    const usage=await getUsageSnapshot(db, { userId: user.id } as Parameters<typeof getUsageSnapshot>[1]); expect(usage.remainingSeconds).toBe(6000);
    await db.begin(async tx=>{ const [reservation]=await tx`insert into shorts_mvp.usage_reservations(user_id,source_duration_seconds,status) values(${user.id},120,'reserved') returning id`; await tx`select shorts_mvp.reserve_usage_grants(${user.id},${reservation.id},120)`; });
    expect((await db`select sum(reserved_seconds)::int as n from shorts_mvp.usage_grants where user_id=${user.id}`)[0].n).toBe(120);
  });
  it("does not grant or select partially when grant creation fails", async () => {
    const app=await apply(); await db.unsafe(`create function shorts_mvp.fail_creator_test_grant() returns trigger language plpgsql as $$ begin if new.product_code='creator_support_100min_v2' and new.valid_from>clock_timestamp() then raise exception 'INJECTED'; end if; return new; end $$; create trigger fail_creator_test_grant before insert on shorts_mvp.usage_grants for each row execute function shorts_mvp.fail_creator_test_grant();`);
    try { expect((await select(app.id)).status).toBeGreaterThanOrEqual(400); expect((await db`select count(*)::int as n from shorts_mvp.usage_grants`)[0].n).toBe(0); expect((await db`select state from shorts_mvp.creator_support_applications where id=${app.id}`)[0].state).toBe('pending_review'); }
    finally { await db.unsafe('drop trigger fail_creator_test_grant on shorts_mvp.usage_grants; drop function shorts_mvp.fail_creator_test_grant();'); }
  });
  it("caps concurrent admin selection at ten and closes recruitment", async () => {
    const ids=[]; for(let i=0;i<11;i++){ const candidate=await account();context.authId=candidate.auth;ids.push((await apply(`creator${i}`)).id); }
    context.authId=admin.auth; const results=await Promise.all(ids.map(id=>select(id))); expect(results.filter(r=>r.status===200)).toHaveLength(10); expect(results.filter(r=>r.status===409)).toHaveLength(1);
    expect((await db`select count(*)::int as n from shorts_mvp.usage_grants`)[0].n).toBe(30); expect((await db`select enrollment_open from shorts_mvp.creator_support_programs`)[0].enrollmentOpen).toBe(false);
  });
  it("rejects outdated terms, closed intake, and the former immediate-enrollment API", async () => {
    const body=await payload(); await db`update shorts_mvp.creator_support_programs set enrollment_open=false`;
    expect((await POST(request("creator-support/application",body))).status).toBe(409);
    const oldBody={accountKey:body.accountKey,requestId:body.requestId,platform:'youtube',channelUrl:body.channels[0].channelUrl,channelName:'channel',assetId:null,ownsChannel:true,termsVersion:'2026-09-11.v1',consents:body.consents};
    expect((await oldEnrollPOST(request('creator-support/enroll',oldBody))).status).toBe(409);
    expect((await POST(request('creator-support/application',{...body,termsVersion:'2026-09-11.v1'}))).status).toBe(400);
  });
  it("removes rejected/expired private data and never spends or revokes unrelated usage", async () => {
    const app=await apply(); context.authId=admin.auth;
    expect((await adminPOST(request('admin/creator-support/applications',{action:'reject',id:app.id,reference:'LOCAL TEST rejected',confirmed:true}))).status).toBe(200);
    expect((await db`select phone_number,consent_snapshot from shorts_mvp.creator_support_applications where id=${app.id}`)[0]).toMatchObject({phoneNumber:null,consentSnapshot:null});
    expect((await db`select channel_url from shorts_mvp.creator_support_application_channels where application_id=${app.id}`).every(c=>c.channelUrl===null)).toBe(true);
    const other=await account(); context.authId=other.auth; const expired=await apply('expirycreator'); await db`update shorts_mvp.creator_support_applications set submitted_at=clock_timestamp()-interval '91 days' where id=${expired.id}`;
    await maintainCreatorApplications(db); expect((await db`select state,phone_number from shorts_mvp.creator_support_applications where id=${expired.id}`)[0]).toMatchObject({state:'expired',phoneNumber:null});
  });
  it("denies direct browser table reads and SQL submission/selection", async () => {
    for(const role of ['anon','authenticated']) {
      const [permissions]=await db`select has_table_privilege(${role},'shorts_mvp.creator_support_applications','SELECT') as can_read,
        has_function_privilege(${role},'shorts_mvp.submit_creator_application(uuid,uuid,text,jsonb,text,jsonb)','EXECUTE') as can_submit,
        has_function_privilege(${role},'shorts_mvp.select_creator_application(uuid,uuid,text)','EXECUTE') as can_select`;
      expect(permissions).toEqual({canRead:false,canSubmit:false,canSelect:false});
    }
  });
  it("preserves legacy 30-minute grants and consent evidence when selecting a new 100-minute partner", async () => {
    const body=await payload();
    await db`update shorts_mvp.creator_support_programs set terms_version='2026-09-11.v1',legal_review_version='2026-09-11.v1'`;
    const response=await oldEnrollPOST(request('creator-support/enroll',{accountKey:body.accountKey,requestId:body.requestId,platform:'youtube',channelUrl:'https://youtube.com/@legacycreator',channelName:'기존 채널',assetId:null,ownsChannel:true,termsVersion:'2026-09-11.v1',consents:body.consents}));
    expect(response.status).toBe(200);
    const before=await db`select to_jsonb(e) as row from shorts_mvp.creator_support_enrollments e where user_id=${user.id}`;
    const grants=await db`select to_jsonb(g) as row from shorts_mvp.usage_grants g where user_id=${user.id} order by id`;
    await db`update shorts_mvp.creator_support_programs set terms_version=${CREATOR_APPLICATION_TERMS_VERSION},legal_review_version=${CREATOR_APPLICATION_TERMS_VERSION}`;
    const candidate=await account();context.authId=candidate.auth;await select((await apply('newcreator')).id);
    expect(await db`select to_jsonb(e) as row from shorts_mvp.creator_support_enrollments e where user_id=${user.id}`).toEqual(before);
    expect(await db`select to_jsonb(g) as row from shorts_mvp.usage_grants g where user_id=${user.id} order by id`).toEqual(grants);
    context.authId=user.auth;expect((await (await GET()).json()).status.installments[0].totalSeconds).toBe(1800);
    expect((await getUsageSnapshot(db,{userId:user.id} as Parameters<typeof getUsageSnapshot>[1])).remainingSeconds).toBe(1800);
  });
});
