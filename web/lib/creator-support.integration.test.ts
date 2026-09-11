import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CREATOR_SUPPORT_TERMS_VERSION, type CreatorSupportMe, type CreatorSupportStatus } from "./creator-support";
import { getUsageSnapshot } from "./usage";
import { getBillingSummary } from "./billing";
import type { MvpSession } from "./session";

const context = vi.hoisted(() => ({ db: null as unknown as Sql, authId: null as string | null }));
vi.mock("@/lib/db", () => ({ getDb: () => context.db }));
vi.mock("@/lib/supabase/server", () => ({ getAuthenticatedUser: async () => context.authId ? { id: context.authId } : null }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: async () => {
  const [row] = await context.db`select id from shorts_mvp.app_users where auth_user_id=${context.authId}`;
  if (!row) throw new Error("로그인이 필요합니다.");
  return { userId: row.id };
} }));
import { GET as activityGET } from "@/app/api/account/activity/route";
import { GET as meGET } from "@/app/api/creator-support/me/route";
import { POST as enrollPOST } from "@/app/api/creator-support/enroll/route";
import { GET as statusGET } from "@/app/api/creator-support/status/route";
import { POST as channelPOST } from "@/app/api/creator-support/channel/route";
import { GET as adminGET, POST as adminPOST } from "@/app/api/admin/creator-support/route";
import { POST as assetPOST } from "@/app/api/creator-support/assets/route";
import { GET as assetGET } from "@/app/api/creator-support/assets/[id]/route";
import { getCreatorStatus, maintainCreatorSupport } from "./creator-support-server";
import sharp from "sharp";

// This suite may only destroy the isolated localhost test database below.
const connection = process.env.CREATOR_SUPPORT_TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/creator_support_test") {
    throw new Error("Creator support integration tests require localhost/creator_support_test.");
  }
}
const migration = (name: string) => readFileSync(path.resolve(__dirname, "../../supabase/migrations", name), "utf8");
const jsonRequest = (route: string, body: unknown, origin = "http://localhost:3000") => new Request(`http://localhost:3000/api/${route}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body),
});
let db: Sql;
let userId: string;
let authId: string;
let adminId: string;
let adminAuthId: string;
async function account(provider = "kakao", email: string | null = null) {
  const id = randomUUID(); const auth = randomUUID();
  await db`insert into shorts_mvp.app_users(id,auth_user_id,display_name,email,provider,created_at) values(${id},${auth},'김크리에이터',${email},${provider},'2026-01-01T16:30:00Z')`;
  return { id, auth };
}
async function input(channelUrl = "https://instagram.com/mycreator") {
  const me = await (await meGET()).json() as CreatorSupportMe;
  return {
    accountKey: me.account.key, requestId: randomUUID(), platform: "instagram", channelUrl,
    channelName: "나의 채널", assetId: null, ownsChannel: true,
    termsVersion: CREATOR_SUPPORT_TERMS_VERSION, consents: { collection: true, disclosure: true, license: true },
  };
}
async function openRecruitment() {
  await db`update shorts_mvp.creator_support_programs set enrollment_open=true,legal_review_version=terms_version,legal_review_reference='LOCAL TEST ONLY',legal_reviewed_at=clock_timestamp()`;
}
async function enroll() {
  const response = await enrollPOST(jsonRequest("creator-support/enroll", await input()));
  expect(response.status).toBe(200);
  return (await response.json()).status as CreatorSupportStatus;
}
async function reserve(seconds: number) {
  return db.begin(async (tx) => {
    const [reservation] = await tx`insert into shorts_mvp.usage_reservations(user_id,source_duration_seconds,status) values(${userId},${seconds},'reserved') returning id`;
    await tx`select shorts_mvp.reserve_usage_grants(${userId},${reservation.id},${seconds})`;
    return reservation.id as string;
  });
}
describe.skipIf(!connection)("creator support PostgreSQL and authenticated APIs", () => {
  beforeAll(async () => {
    db = postgres(connection!, { max: 8, prepare: false, transform: postgres.camel, onnotice: () => undefined });
    context.db = db;
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
      await migrationConnection.unsafe(migration("202609110001_creator_support.sql"));
      await migrationConnection.unsafe(migration("202609110002_creator_support_usage.sql"));
    } finally { migrationConnection.release(); }
  }, 30_000);
  beforeEach(async () => {
    await db`truncate shorts_mvp.app_users,shorts_mvp.billing_orders,shorts_mvp.user_subscriptions,shorts_mvp.usage_reservations cascade`;
    await db`insert into shorts_mvp.creator_support_programs(code,terms_version) values('creator_support_2026_v1',${CREATOR_SUPPORT_TERMS_VERSION}) on conflict(code) do update set enrollment_open=false,legal_review_version=null,legal_review_reference=null,legal_reviewed_at=null`;
    const user = await account(); userId = user.id; authId = user.auth; context.authId = authId;
    const admin = await account("google", "admin@example.test"); adminId = admin.id; adminAuthId = admin.auth;
    await db`update shorts_mvp.app_users set is_admin=true where id=${adminId}`;
  });
  afterAll(async () => { if (db) await db.end(); });

  it("defaults OFF and requires a real admin review record before opening", async () => {
    const closed = await enrollPOST(jsonRequest("creator-support/enroll", await input()));
    expect(closed.status).toBe(409);
    context.authId = adminAuthId;
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "recruitment", open: true }))).status).toBe(409);
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "legal_review", reference: "LOCAL TEST ONLY", reviewed: true }))).status).toBe(200);
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "recruitment", open: true }))).status).toBe(200);
    expect((await db`select enrollment_open from shorts_mvp.creator_support_programs`)[0].enrollmentOpen).toBe(true);
  });
  it.each([null, "ka***@kakao.com", "????@kakao.com"])("enrolls Kakao with email %s and shows the actual app join date", async (email) => {
    await db`update shorts_mvp.app_users set email=${email} where id=${userId}`;
    const response = await meGET();
    expect(response.headers.get("cache-control")).toContain("no-store");
    const me = await response.json();
    expect(me.account).toMatchObject({ name: "김****", email: null, provider: "카카오", joinedAt: "2026-01-01T16:30:00.000Z" });
    expect(me.account.id).toBeUndefined();
    await openRecruitment(); const result = await enroll();
    expect(result.installments).toHaveLength(3);
    expect(result.installments.map((g) => g.state)).toEqual(["available", "scheduled", "scheduled"]);
    expect(result.installments.map((g) => g.remainingSeconds)).toEqual([1800, 0, 0]);
  });
  it("enrolls Google and does not disclose the full email or name", async () => {
    await db`update shorts_mvp.app_users set provider='google',email='creator@gmail.com' where id=${userId}`;
    const me = await (await meGET()).json();
    expect(me.account).toMatchObject({ provider: "구글", email: "c***@gmail.com" });
    await openRecruitment(); await enroll();
  });
  it("rejects anonymous, foreign account keys, user ID injection, and cross-origin submissions", async () => {
    await openRecruitment(); const draft = await input();
    context.authId = null;
    for (const result of [await meGET(), await statusGET(), await enrollPOST(jsonRequest("creator-support/enroll", draft))]) {
      expect(result.status).toBe(401); expect(result.headers.get("cache-control")).toContain("no-store");
    }
    context.authId = adminAuthId;
    expect((await enrollPOST(jsonRequest("creator-support/enroll", draft))).status).toBe(409);
    context.authId = authId;
    expect((await enrollPOST(jsonRequest("creator-support/enroll", { ...draft, userId: adminId }))).status).toBe(400);
    expect((await enrollPOST(jsonRequest("creator-support/enroll", { ...draft, consents: { ...draft.consents, license: false } }))).status).toBe(400);
    expect((await enrollPOST(jsonRequest("creator-support/enroll", draft, "https://evil.test"))).status).toBe(403);
    expect((await adminGET(new Request("http://localhost:3000/api/admin/creator-support"))).status).toBe(403);
    expect((await db`select count(*)::int as n from shorts_mvp.usage_grants`)[0].n).toBe(0);
  });
  it("commits exactly three grants across concurrent clicks and later retries, including after closure", async () => {
    await openRecruitment(); const draft = await input();
    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => enrollPOST(jsonRequest("creator-support/enroll", { ...draft, requestId: index % 2 ? randomUUID() : draft.requestId }))));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
    const ids = await Promise.all(responses.map(async (r) => (await r.json()).status.id));
    expect(new Set(ids).size).toBe(1);
    expect((await db`select count(*)::int as n from shorts_mvp.usage_grants`)[0].n).toBe(3);
    await db`update shorts_mvp.creator_support_programs set enrollment_open=false`;
    expect((await enrollPOST(jsonRequest("creator-support/enroll", draft))).status).toBe(200);
    expect((await db`select count(*)::int as n from shorts_mvp.creator_support_audit where action='enrolled'`)[0].n).toBe(1);
  });
  it("rejects normalized duplicate channels across two accounts", async () => {
    await openRecruitment(); await enroll(); context.authId = adminAuthId;
    const draft = await input("http://www.instagram.com/MYCREATOR/?igsh=one");
    expect((await channelPOST(jsonRequest("creator-support/channel", { accountKey: draft.accountKey, platform: draft.platform, channelUrl: draft.channelUrl }))).status).toBe(409);
    expect((await enrollPOST(jsonRequest("creator-support/enroll", draft))).status).toBe(409);
    expect((await db`select count(*)::int as n from shorts_mvp.usage_grants`)[0].n).toBe(3);
  });
  it("rolls enrollment and consent back if the second grant cannot be written", async () => {
    await openRecruitment();
    await db.unsafe(`create function shorts_mvp.test_fail_grant() returns trigger language plpgsql as $$ begin
      if new.valid_from>clock_timestamp()+interval '1 day' then raise exception 'test second grant failure'; end if; return new;
      end $$; create trigger test_fail_grant before insert on shorts_mvp.usage_grants for each row execute function shorts_mvp.test_fail_grant();`);
    try {
      expect((await enrollPOST(jsonRequest("creator-support/enroll", await input()))).status).not.toBe(200);
      expect((await db`select count(*)::int as n from shorts_mvp.usage_grants`)[0].n).toBe(0);
      expect((await db`select count(*)::int as n from shorts_mvp.creator_support_enrollments`)[0].n).toBe(0);
      expect((await db`select count(*)::int as n from shorts_mvp.creator_support_audit where action='enrolled'`)[0].n).toBe(0);
    } finally { await db.unsafe("drop trigger test_fail_grant on shorts_mvp.usage_grants; drop function shorts_mvp.test_fail_grant()"); }
  });
  it.each([
    ["2026-01-31T14:35:22.123Z", 1, "2026-02-28T14:35:22.123Z"],
    ["2026-01-31T14:35:22.123Z", 2, "2026-03-31T14:35:22.123Z"],
    ["2028-01-31T14:35:22.123Z", 1, "2028-02-29T14:35:22.123Z"],
    ["2028-02-29T00:00:00Z", 12, "2029-02-28T00:00:00.000Z"],
    ["2026-01-30T16:01:00Z", 1, "2026-02-27T16:01:00.000Z"],
  ])("keeps KST anchor and clamps month boundaries %s + %s", async (anchor, months, expected) => {
    const [row] = await db`select shorts_mvp.creator_support_month(${anchor}::timestamptz,${months}::integer) as boundary`;
    expect(row.boundary.toISOString()).toBe(expected);
  });
  it("lets free accounts reserve and consume only the current 30 minutes", async () => {
    await openRecruitment(); await enroll();
    const session = { userId } as MvpSession;
    expect((await getUsageSnapshot(db, session)).remainingSeconds).toBe(1800);
    const reservation = await reserve(600);
    let usage = await getUsageSnapshot(db, session);
    expect(usage.remainingSeconds).toBe(1200); expect(usage.reservedSeconds).toBe(600);
    await db`update shorts_mvp.usage_reservations set status='consumed' where id=${reservation}`;
    usage = await getUsageSnapshot(db, session);
    expect(usage.usedSeconds).toBe(600); expect(usage.reservedSeconds).toBe(0);
    await expect(reserve(1201)).rejects.toThrow();
    expect((await getUsageSnapshot(db, session)).remainingSeconds).toBe(1200);
    expect((await db`select sum(consumed_seconds)::int as n from shorts_mvp.usage_grants where valid_from>clock_timestamp()`)[0].n).toBe(0);
  });
  it("enables creation without granting a paid plan or managed features, and future grants do not unlock access", async () => {
    expect((await getBillingSummary(db, userId)).canCreateJobs).toBe(false);
    await openRecruitment(); await enroll();
    expect(await getBillingSummary(db, userId)).toMatchObject({ canCreateJobs: true, planCode: "free", status: "none", hasPaymentHistory: false, hasManagedFeatureAccess: false, maxActiveJobs: 1, retentionDays: 1 });
    const reservation = await reserve(1800);
    await db`update shorts_mvp.usage_reservations set status='consumed' where id=${reservation}`;
    expect((await getBillingSummary(db, userId)).canCreateJobs).toBe(false);
    expect((await getUsageSnapshot(db, { userId } as MvpSession)).remainingSeconds).toBe(0);
  });
  it("shows only started installments in usage history, with the activation time rather than precreation time", async () => {
    await openRecruitment(); const enrolled = await enroll();
    let activity = await (await activityGET(new Request("http://localhost:3000/api/account/activity?type=usage"))).json();
    expect(activity.total).toBe(1); expect(activity.items).toHaveLength(1);
    expect(activity.items[0]).toMatchObject({ eventType: "creator_support_grant", seconds: 1800 });
    await db`update shorts_mvp.usage_grants g set valid_from=clock_timestamp()-interval '1 second'
      from shorts_mvp.creator_support_installments i where i.grant_id=g.id and i.enrollment_id=${enrolled.id} and i.installment=2`;
    activity = await (await activityGET(new Request("http://localhost:3000/api/account/activity?type=usage"))).json();
    expect(activity.total).toBe(2); expect(activity.items).toHaveLength(2);
    const [grant] = await db`select g.valid_from from shorts_mvp.usage_grants g join shorts_mvp.creator_support_installments i on i.grant_id=g.id where i.enrollment_id=${enrolled.id} and i.installment=2`;
    expect(activity.items.some((item: { occurredAt: string }) => item.occurredAt === grant.validFrom.toISOString())).toBe(true);
  });
  it("preserves paid-before-complimentary allocation and releases unused reservations", async () => {
    await openRecruitment(); await enroll();
    await db`insert into shorts_mvp.user_subscriptions(user_id,status,current_period_start,current_period_end) values(${userId},'active',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 month')`;
    const [order] = await db`insert into shorts_mvp.billing_orders default values returning id`;
    const [paid] = await db`insert into shorts_mvp.usage_grants(user_id,billing_order_id,kind,product_code,total_seconds,valid_from,expires_at) values(${userId},${order.id},'addon','minutes_50',3000,clock_timestamp()-interval '1 day',clock_timestamp()+interval '3 months') returning id`;
    const reservation = await reserve(600);
    expect((await db`select grant_id from shorts_mvp.usage_grant_allocations where reservation_id=${reservation}`)[0].grantId).toBe(paid.id);
    await db`update shorts_mvp.usage_reservations set status='released' where id=${reservation}`;
    expect((await getUsageSnapshot(db, { userId } as MvpSession)).remainingSeconds).toBe(4800);
  });
  it("expires prior installments at the same boundary the next becomes available", async () => {
    await openRecruitment(); const enrolled = await enroll();
    await db`update shorts_mvp.usage_grants g set valid_from=clock_timestamp()-interval '1 month',expires_at=clock_timestamp()-interval '1 second'
      from shorts_mvp.creator_support_installments i where i.grant_id=g.id and i.enrollment_id=${enrolled.id} and i.installment=1`;
    await db`update shorts_mvp.usage_grants g set valid_from=clock_timestamp()-interval '1 second'
      from shorts_mvp.creator_support_installments i where i.grant_id=g.id and i.enrollment_id=${enrolled.id} and i.installment=2`;
    expect((await getUsageSnapshot(db, { userId } as MvpSession)).remainingSeconds).toBe(1800);
    expect((await getCreatorStatus(userId))?.installments.map((g) => g.state)).toEqual(["expired", "available", "scheduled"]);
    const reservation = await reserve(600);
    const [allocated] = await db`select i.installment from shorts_mvp.usage_grant_allocations a join shorts_mvp.creator_support_installments i on i.grant_id=a.grant_id where a.reservation_id=${reservation}`;
    expect(allocated.installment).toBe(2);
  });
  it("requires rights confirmation, stops future grants, removes material, and records external takedown", async () => {
    await openRecruitment(); const enrolled = await enroll(); context.authId = adminAuthId;
    expect((await (await adminGET(new Request("http://localhost:3000/api/admin/creator-support?eligible=true"))).json()).items).toHaveLength(0);
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "verify_rights", id: enrolled.id, reference: "LOCAL TEST RIGHTS", verified: true }))).status).toBe(200);
    expect((await (await adminGET(new Request("http://localhost:3000/api/admin/creator-support?eligible=true"))).json()).items).toHaveLength(1);
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "stop", id: enrolled.id, reference: "LOCAL TEST WITHDRAWAL" }))).status).toBe(200);
    const status = await getCreatorStatus(userId);
    expect(status?.installments.map((g) => g.state)).toEqual(["available", "canceled", "canceled"]);
    expect(status?.installments[0].expiresAt).toBe(enrolled.installments[0].expiresAt);
    expect(status?.channelUrl).toBeNull();
    expect(status?.promotionStatus).toBe("stopped");
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "verify_rights", id: enrolled.id, reference: "LOCAL TEST RIGHTS", verified: true }))).status).toBe(409);
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "takedown_complete", id: enrolled.id, reference: "LOCAL TEST REMOVED" }))).status).toBe(200);
  });
  it("normalizes uploaded images privately and prevents cross-account attachment and viewing", async () => {
    await openRecruitment(); const draft = await input();
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } }).png().toBuffer();
    const response = await assetPOST(jsonRequest("creator-support/assets", { accountKey: draft.accountKey, image: bytes.toString("base64") }));
    expect(response.status).toBe(200); const { assetId } = await response.json();
    const imageResponse = await assetGET(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) });
    expect(imageResponse.headers.get("content-type")).toBe("image/webp");
    expect(imageResponse.headers.get("cache-control")).toContain("no-store");
    const other = await account(); context.authId = other.auth;
    expect((await assetGET(new Request("http://localhost:3000"), { params: Promise.resolve({ id: assetId }) })).status).toBe(403);
    expect((await enrollPOST(jsonRequest("creator-support/enroll", { ...await input(), assetId }))).status).toBe(400);
    context.authId = authId;
    expect((await enrollPOST(jsonRequest("creator-support/enroll", { ...draft, assetId }))).status).toBe(200);
    expect((await db`select count(*)::int as n from shorts_mvp.usage_grants`)[0].n).toBe(3);
  });
  it("keeps expired promotions out of the eligible list before maintenance and removes expired material", async () => {
    await openRecruitment(); const enrolled = await enroll();
    await db`update shorts_mvp.creator_support_enrollments set activated_at=clock_timestamp()-interval '2 years',support_ends_at=clock_timestamp()-interval '21 months',promotion_ends_at=clock_timestamp()-interval '1 year',promotion_status='approved',rights_verified_at=clock_timestamp()-interval '2 years' where id=${enrolled.id}`;
    context.authId = adminAuthId;
    expect((await (await adminGET(new Request("http://localhost:3000/api/admin/creator-support?eligible=true"))).json()).items).toHaveLength(0);
    await maintainCreatorSupport(db);
    const [row] = await db`select channel_name,channel_url,consent_snapshot,promotion_status from shorts_mvp.creator_support_enrollments where id=${enrolled.id}`;
    expect(row).toMatchObject({ channelName: null, channelUrl: null, consentSnapshot: null, promotionStatus: "expired" });
  });
  it("does not expose tables or enrollment/grant functions to browser database roles", async () => {
    const [row] = await db`select has_table_privilege('authenticated','shorts_mvp.creator_support_enrollments','SELECT') as can_read,
      has_function_privilege('anon','shorts_mvp.enroll_creator_support(uuid,uuid,text,text,text,text,uuid,text,jsonb)','EXECUTE') as can_enroll`;
    expect(row).toMatchObject({ canRead: false, canEnroll: false });
  });
  it("permanently closes recruitment without canceling grants, then deletes minimum records after their purpose ends", async () => {
    await openRecruitment(); const enrolled = await enroll(); context.authId = adminAuthId;
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "retire", reference: "LOCAL TEST RETIRED", confirmed: true }))).status).toBe(200);
    expect((await adminPOST(jsonRequest("admin/creator-support", { action: "recruitment", open: true }))).status).toBe(409);
    expect((await getCreatorStatus(userId))?.installments.map((g) => g.state)).toEqual(["available", "scheduled", "scheduled"]);
    await maintainCreatorSupport(db);
    expect(await getCreatorStatus(userId)).not.toBeNull();
    await db`update shorts_mvp.creator_support_enrollments set activated_at=clock_timestamp()-interval '2 years',support_ends_at=clock_timestamp()-interval '21 months',promotion_ends_at=clock_timestamp()-interval '1 year' where id=${enrolled.id}`;
    await maintainCreatorSupport(db);
    expect(await getCreatorStatus(userId)).toBeNull();
    expect((await db`select count(*)::int as n from shorts_mvp.creator_support_audit where enrollment_id=${enrolled.id}`)[0].n).toBe(0);
  });
});
