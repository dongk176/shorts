import { readFileSync } from "node:fs";
import { generateKeyPairSync, verify } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import type { Sql } from "postgres";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => sql, ensureAdminDbReady: async () => {} }));
vi.mock("@/lib/admin-mobile-push", () => ({ sendMobilePush: vi.fn(async () => ({})) }));
const inventoryMock = vi.hoisted(()=>vi.fn(async()=>[] as Array<{routeId:string;identity:string;assignedAt:string;assignmentExact:boolean}>));
vi.mock("@/lib/admin-ip-inventory",()=>({loadRouteAssignments:inventoryMock}));
let nativeCookie: string | undefined;
vi.mock("next/headers", () => ({ cookies: async () => ({get: () => nativeCookie ? {value:nativeCookie} : undefined}) }));
import { allowedPushEndpoint, defaultMobilePreferences, isQuietHour, shouldNotify, subscriptionSchema } from "./admin-mobile-contract";
import { loadAdminMobileOverview, loadMobileRoutes } from "./admin-mobile-overview";
import { dispatchMobilePushes, notificationContent, operationalIncidents, scanMobileEvents } from "./admin-mobile-monitor";
import { sendMobilePush } from "./admin-mobile-push";
import { createNativeCode, exchangeNativeCode, nativeAdminUser, pkceChallenge } from "./admin-native-auth";
import { apnsJwt, registerNativeDevice } from "./admin-native-push";
import { nativeDeviceSchema } from "./admin-native-contract";

let pg: PGlite;
const uid = "00000000-0000-4000-8000-000000000001";
const sid = "00000000-0000-4000-8000-000000000002";
const sql = (async (strings: TemplateStringsArray,...values: unknown[]) => {
  const query = strings.reduce((s,p,i) => s+(i ? "$"+i : "")+p,"");
  if (query.includes("pg_try_advisory_xact_lock") || query.includes("pg_advisory_xact_lock")) return [{ acquired: true }];
  const { rows } = await pg.query<Record<string,unknown>>(query,values);
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k.replace(/_([a-z])/g,(_,c) => c.toUpperCase()),v])));
}) as unknown as Sql;
Object.assign(sql,{ begin: async (fn: (sql: Sql) => Promise<unknown>) => {
  await pg.exec("begin");
  try { const value = await fn(sql); await pg.exec("commit"); return value; }
  catch (error) { await pg.exec("rollback"); throw error; }
}});
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema shorts_mvp; create role anon; create role authenticated; create role service_role;
    create table shorts_mvp.app_users(id uuid primary key,is_admin boolean,auth_user_id uuid,email text,display_name text,created_at timestamptz default now());
    create table shorts_mvp.billing_orders(id uuid primary key default gen_random_uuid(),order_id text,kind text,amount_krw bigint,refunded_amount_krw bigint default 0,status text,approved_at timestamptz,created_at timestamptz default now());
    create table shorts_mvp.paddle_subscriptions(paddle_id text primary key,environment text,created_at timestamptz default now());
    create table shorts_mvp.paddle_payments(transaction_id text primary key,paddle_subscription_id text,currency text,amount_minor bigint,grant_id uuid,created_at timestamptz default now());
    create table shorts_mvp.paddle_adjustments(transaction_id text,amount_minor bigint,status text,action text);
    create table shorts_mvp.usage_grants(billing_order_id uuid);
    create table shorts_mvp.video_jobs(id uuid default gen_random_uuid(),user_id uuid,status text,created_at timestamptz default now());
    create table shorts_mvp.user_subscriptions(user_id uuid,status text);
    create table shorts_mvp.customer_inquiries(status text);
    create table shorts_mvp.ingestion_route_slots(route_id text,enabled boolean,cooldown_until timestamptz);
    create table shorts_mvp.ingestion_attempts(id uuid default gen_random_uuid(),job_id uuid,route_id text,result text,created_at timestamptz default now());
    create table shorts_mvp.ingestion_circuit(singleton boolean,blocked_until timestamptz);
    insert into shorts_mvp.app_users(id,is_admin) values('${uid}',true);
    insert into shorts_mvp.paddle_subscriptions values('live','live',now()),('sandbox','sandbox',now());`);
  await pg.exec(readFileSync(new URL("../../supabase/migrations/202610050001_admin_mobile_push.sql",import.meta.url),"utf8"));
  await pg.exec(readFileSync(new URL("../../supabase/migrations/202610050002_admin_native_push.sql",import.meta.url),"utf8"));
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  vi.clearAllMocks();vi.unstubAllEnvs();nativeCookie=undefined;inventoryMock.mockResolvedValue([]);
  await pg.exec(`truncate shorts_mvp.admin_mobile_events,shorts_mvp.admin_mobile_deliveries,shorts_mvp.admin_mobile_receipts,
    shorts_mvp.admin_mobile_subscriptions,shorts_mvp.admin_mobile_preferences,shorts_mvp.admin_native_auth_codes,shorts_mvp.admin_native_sessions,shorts_mvp.billing_orders,
    shorts_mvp.paddle_payments,shorts_mvp.paddle_adjustments,shorts_mvp.video_jobs,shorts_mvp.ingestion_route_slots,shorts_mvp.ingestion_attempts;
    update shorts_mvp.admin_mobile_monitor_state set started_at=now()-interval '1 day';
    update shorts_mvp.app_users set is_admin=true;`);
});
describe("native login and APNs boundary",()=>{
  const verifier="v".repeat(43),token="a".repeat(64),installationId="00000000-0000-4000-8000-000000000099";
  function configure(){for(const name of ["ADMIN_APNS_KEY_ID","ADMIN_APNS_TEAM_ID","ADMIN_APNS_PRIVATE_KEY","ADMIN_APNS_TOPIC"])vi.stubEnv(name,"test");vi.stubEnv("ADMIN_MOBILE_ENABLED","1");}
  it("binds a single-use login code to PKCE and stores only hashed session credentials",async()=>{
    const code=await createNativeCode(uid,pkceChallenge(verifier));
    await expect(exchangeNativeCode(code,"x".repeat(43))).rejects.toMatchObject({status:401});
    nativeCookie=await exchangeNativeCode(code,verifier);
    expect(await nativeAdminUser()).toMatchObject({id:uid});
    await expect(exchangeNativeCode(code,verifier)).rejects.toMatchObject({status:401});
    const {rows}=await pg.query("select * from shorts_mvp.admin_native_sessions");
    expect(JSON.stringify(rows)).not.toContain(nativeCookie);
    await pg.exec("update shorts_mvp.app_users set is_admin=false");
    expect(await nativeAdminUser()).toBeNull();
  });
  it("rejects expired login codes and expired native sessions",async()=>{
    const code=await createNativeCode(uid,pkceChallenge(verifier));
    await pg.exec("update shorts_mvp.admin_native_auth_codes set expires_at=now()-interval '1 second'");
    await expect(exchangeNativeCode(code,verifier)).rejects.toMatchObject({status:401});
    nativeCookie=await exchangeNativeCode(await createNativeCode(uid,pkceChallenge(verifier)),verifier);
    await pg.exec("update shorts_mvp.admin_native_sessions set expires_at=now()-interval '1 second'");
    expect(await nativeAdminUser()).toBeNull();
  });
  it("rotates the APNs token on the same installation without replaying past events",async()=>{
    configure();
    await registerNativeDevice(uid,{installationId,token,environment:"development"});
    await pg.exec("update shorts_mvp.admin_mobile_subscriptions set active_from=now()-interval '1 hour'");
    await registerNativeDevice(uid,{installationId,token:"b".repeat(64),environment:"production"});
    const {rows}=await pg.query<{apns_token:string,transport:string,old:boolean}>("select apns_token,transport,active_from<now()-interval '30 minutes' as old from shorts_mvp.admin_mobile_subscriptions");
    expect(rows).toEqual([{apns_token:"b".repeat(64),transport:"apns",old:true}]);
    // This test covers token rotation, independently of Seoul quiet hours.
    await pg.exec(`insert into shorts_mvp.admin_mobile_preferences(admin_id,quiet_night) values('${uid}',false)`);
    await payment();await scanMobileEvents();await dispatchMobilePushes();
    expect(sendMobilePush).toHaveBeenCalledWith(expect.objectContaining({transport:"apns",apnsToken:"b".repeat(64),apnsEnvironment:"production"}),expect.anything());
  });
  it("rejects token ownership takeover by a different administrator",async()=>{
    configure();await registerNativeDevice(uid,{installationId,token,environment:"development"});
    await expect(registerNativeDevice("00000000-0000-4000-8000-000000000011",{installationId,token,environment:"development"})).rejects.toMatchObject({status:409});
  });
  it("keeps native registration unavailable before the APNs server is configured",async()=>{
    await expect(registerNativeDevice(uid,{installationId,token,environment:"development"})).rejects.toMatchObject({status:503});
    expect(nativeDeviceSchema.safeParse({installationId,token:"https://evil.test",environment:"development"}).success).toBe(false);
    expect(nativeDeviceSchema.safeParse({installationId,token,environment:"unknown"}).success).toBe(false);
  });
  it("produces an Apple-compatible ES256 token with a verifiable signature",()=>{
    const {privateKey,publicKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
    const pem=privateKey.export({format:"pem",type:"pkcs8"}).toString();
    const jwt=apnsJwt("KEY123","TEAM123",pem,1_700_000_000_000);
    const [header,claims,signature]=jwt.split(".");
    expect(JSON.parse(Buffer.from(header,"base64url").toString())).toEqual({alg:"ES256",kid:"KEY123"});
    expect(JSON.parse(Buffer.from(claims,"base64url").toString())).toEqual({iss:"TEAM123",iat:1700000000});
    expect(verify("sha256",Buffer.from(header+"."+claims),{key:publicKey,dsaEncoding:"ieee-p1363"},Buffer.from(signature,"base64url"))).toBe(true);
  });
});
async function device() {
  await pg.exec(`insert into shorts_mvp.admin_mobile_subscriptions(id,admin_id,endpoint,p256dh,auth,active_from)
    values('${sid}','${uid}','https://web.push.apple.com/test','${"x".repeat(87)}','${"x".repeat(22)}',now()-interval '1 hour');
    insert into shorts_mvp.admin_mobile_preferences(admin_id,quiet_night) values('${uid}',false);`);
}
async function payment() {
  await pg.exec(`insert into shorts_mvp.billing_orders(order_id,kind,amount_krw,status,approved_at)
    values('order-test','subscription_initial',39000,'succeeded',now());`);
}
describe("mobile push policy", () => {
  it("allows only supported HTTPS push endpoints", () => {
    expect(allowedPushEndpoint("https://web.push.apple.com/Q/device")).toBe(true);
    expect(allowedPushEndpoint("https://fcm.googleapis.com/fcm/send/id")).toBe(true);
    for (const url of ["http://web.push.apple.com/a","https://127.0.0.1/a","https://web.push.apple.com.evil.test/a","https://user@web.push.apple.com/a","https://web.push.apple.com:444/a","https://web.push.apple.com/a#fragment"]) expect(allowedPushEndpoint(url)).toBe(false);
  });
  it("validates actual key lengths and the uncompressed P-256 prefix", () => {
    const good = {endpoint:"https://web.push.apple.com/test",keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString("base64url"),auth:Buffer.alloc(16).toString("base64url")}};
    expect(subscriptionSchema.safeParse(good).success).toBe(true);
    expect(subscriptionSchema.safeParse({...good,keys:{...good.keys,p256dh:Buffer.alloc(65).toString("base64url")}}).success).toBe(false);
  });
  it("uses Seoul night boundaries and respects an explicit operations opt-out", () => {
    expect(isQuietHour(new Date("2026-10-05T13:59:00Z"))).toBe(false);
    expect(isQuietHour(new Date("2026-10-05T14:00:00Z"))).toBe(true);
    expect(isQuietHour(new Date("2026-10-05T22:59:00Z"))).toBe(true);
    expect(isQuietHour(new Date("2026-10-05T23:00:00Z"))).toBe(false);
    const now=new Date("2026-10-05T16:00:00Z");
    expect(shouldNotify("payment",defaultMobilePreferences,now)).toBe(false);
    expect(shouldNotify("urgent",defaultMobilePreferences,now)).toBe(true);
    expect(shouldNotify("urgent",{...defaultMobilePreferences,operations:false},now)).toBe(false);
  });
  it("keeps currency units correct and hides amounts when requested", () => {
    const event={id:"x",kind:"payment",title:"결제 완료",payload:{amountMinor:399,currency:"USD",email:"private@example.test"}};
    expect(notificationContent(event,true).body).toContain("3.99");
    expect(JSON.stringify(notificationContent(event,false))).not.toMatch(/399|3.99|private/);
    expect(notificationContent({...event,payload:{amountMinor:590,currency:"JPY"}},true).body).toContain("590");
  });
});
describe("persisted monitoring and delivery", () => {
  it("deduplicates repeated scans, delivers once and never backfills old payments", async () => {
    await device();await payment();
    await pg.exec(`insert into shorts_mvp.billing_orders(order_id,kind,amount_krw,status,approved_at) values('old','subscription_initial',100,'succeeded',now()-interval '2 days');`);
    await scanMobileEvents();await scanMobileEvents();
    expect((await pg.query("select * from shorts_mvp.admin_mobile_events")).rows).toHaveLength(1);
    expect(await dispatchMobilePushes()).toMatchObject({sent:1});
    expect(await dispatchMobilePushes()).toMatchObject({sent:0});
    expect(sendMobilePush).toHaveBeenCalledTimes(1);
  });
  it("excludes Paddle sandbox from revenue and notifications and preserves approved refunds", async () => {
    await device();await payment();
    await pg.exec(`insert into shorts_mvp.paddle_payments(transaction_id,paddle_subscription_id,currency,amount_minor) values('live-txn','live','USD',399),('test-txn','sandbox','USD',99999);
      insert into shorts_mvp.paddle_adjustments values('live-txn',100,'approved','refund'),('live-txn',99,'pending_approval','refund');
      update shorts_mvp.billing_orders set status='canceled',refunded_amount_krw=1000;`);
    await scanMobileEvents();
    const snapshot=await loadAdminMobileOverview(uid);
    expect(snapshot.availability.billing).toBe(true);
    expect(snapshot.dailySales.find(r=>r.currency==="USD")).toMatchObject({gross:399,refunds:100});
    expect(snapshot.dailySales.find(r=>r.currency==="KRW")).toMatchObject({gross:39000,refunds:1000});
    expect(snapshot.payments).toHaveLength(2);
    expect((await pg.query("select * from shorts_mvp.admin_mobile_events")).rows).toHaveLength(2);
  });
  it("does not push payments from before this device subscribed", async () => {
    await device();await payment();
    await pg.exec("update shorts_mvp.admin_mobile_subscriptions set active_from=now()+interval '1 minute'");
    await scanMobileEvents();await dispatchMobilePushes();
    expect(sendMobilePush).not.toHaveBeenCalled();
  });
  it("rechecks administrator access and preferences before sending", async () => {
    await device();await payment();await scanMobileEvents();
    await pg.exec("update shorts_mvp.app_users set is_admin=false");
    expect(await dispatchMobilePushes()).toMatchObject({skipped:1});
    expect(sendMobilePush).not.toHaveBeenCalled();
  });
  it("skips disabled categories and preserves the event in the inbox", async () => {
    await device();await payment();await scanMobileEvents();
    await pg.exec("update shorts_mvp.admin_mobile_preferences set payments=false");
    expect(await dispatchMobilePushes()).toMatchObject({skipped:1});
    expect((await pg.query("select * from shorts_mvp.admin_mobile_events")).rows).toHaveLength(1);
  });
  it("retires expired subscriptions and bounds retries for provider outages", async () => {
    await device();await payment();await scanMobileEvents();
    vi.mocked(sendMobilePush).mockRejectedValueOnce({statusCode:410});
    expect(await dispatchMobilePushes()).toMatchObject({skipped:1});
    expect((await pg.query<{active:boolean}>("select active from shorts_mvp.admin_mobile_subscriptions")).rows[0].active).toBe(false);
  });
  it("recovers stale leases and stops after three failed sends", async () => {
    await device();await payment();await scanMobileEvents();
    vi.mocked(sendMobilePush).mockRejectedValue({statusCode:503});
    for(let i=0;i<3;i++) {
      await dispatchMobilePushes();
      await pg.exec("update shorts_mvp.admin_mobile_deliveries set available_at=now()-interval '1 second'");
    }
    expect((await pg.query<{status:string,attempts:number}>("select status,attempts from shorts_mvp.admin_mobile_deliveries")).rows[0]).toEqual({status:"failed",attempts:3});
    await dispatchMobilePushes();expect(sendMobilePush).toHaveBeenCalledTimes(3);
    vi.mocked(sendMobilePush).mockResolvedValue({statusCode:201,body:"",headers:{}});
  });
  it("keeps one open incident, requires stable recovery, and records a recovery event", async () => {
    await pg.exec("insert into shorts_mvp.video_jobs(status,created_at) select 'queued',now()-interval '20 minutes' from generate_series(1,3)");
    await scanMobileEvents();await scanMobileEvents();
    expect((await pg.query("select * from shorts_mvp.admin_mobile_events where incident_key='queue-stalled'")).rows).toHaveLength(1);
    await pg.exec("delete from shorts_mvp.video_jobs");await scanMobileEvents();
    expect((await pg.query("select * from shorts_mvp.admin_mobile_events where kind='recovery'")).rows).toHaveLength(0);
    await pg.exec("update shorts_mvp.admin_mobile_events set healthy_since=now()-interval '3 minutes'");
    await scanMobileEvents();
    expect((await pg.query("select * from shorts_mvp.admin_mobile_events where kind='recovery'")).rows).toHaveLength(1);
  });
  it("requires distinct impacted customers for a widespread-failure alert", () => {
    const row={waiting:0,oldestWait:0,running:0,failures:3,failedCustomers:1,billingReview:0,circuitBlocked:false};
    expect(operationalIncidents(row).find(i=>i.key==="multiple-job-failures")?.active).toBe(false);
    expect(operationalIncidents({...row,failedCustomers:2}).find(i=>i.key==="multiple-job-failures")?.active).toBe(true);
  });
  it("does not report a short protection pause as an ingestion outage", () => {
    const row={waiting:1,oldestWait:1,running:2,failures:0,failedCustomers:0,billingReview:0,circuitBlocked:true,recentIngestionSuccess:true};
    const paused=(value:Record<string,unknown>)=>operationalIncidents(value).find(i=>i.key==="ingestion-paused")?.active;
    expect(paused(row)).toBe(false);
    expect(paused({...row,oldestWait:10})).toBe(false);
    expect(paused({...row,oldestWait:10,recentIngestionSuccess:false})).toBe(true);
    expect(paused({...row,waiting:0,oldestWait:10,recentIngestionSuccess:false})).toBe(false);
  });
  it("clips every IP window at its verified assignment and leaves ambiguous denominators unknown", async () => {
    await pg.exec("insert into shorts_mvp.ingestion_route_slots values('webshare-01',true,null);insert into shorts_mvp.ingestion_attempts(route_id,result,created_at) values('webshare-01','success',now()),('webshare-01','bot_check',now()-interval '2 hours')");
    expect((await loadMobileRoutes())[0].samples["24"]).toBeNull();
    inventoryMock.mockResolvedValue([{routeId:"webshare-01",identity:"abc1234567",assignedAt:new Date(Date.now()-3600000).toISOString(),assignmentExact:true}]);
    await pg.exec("insert into shorts_mvp.video_jobs(id,status) values('00000000-0000-4000-8000-000000000042','completed');update shorts_mvp.ingestion_attempts set job_id='00000000-0000-4000-8000-000000000042'");
    expect((await loadMobileRoutes())[0].samples["24"]).toEqual([1,1]);
    await pg.exec("insert into shorts_mvp.ingestion_attempts(job_id,route_id,result) values('00000000-0000-4000-8000-000000000042','webshare-01','other_error')");
    expect((await loadMobileRoutes())[0].samples["1"]).toBeNull();
  });
  it("protects all six state tables from public Supabase roles", async () => {
    const {rows}=await pg.query<{tablename:string;rowsecurity:boolean}>("select tablename,rowsecurity from pg_tables where schemaname='shorts_mvp' and tablename like 'admin_mobile_%'");
    expect(rows).toHaveLength(6);expect(rows.every(r=>r.rowsecurity)).toBe(true);
    const {rows:access}=await pg.query<{allowed:boolean}>("select has_table_privilege('authenticated','shorts_mvp.admin_mobile_subscriptions','SELECT') as allowed");
    expect(access[0].allowed).toBe(false);
  });
  it("excludes tasks that started before replacement even if they reported afterwards", async()=>{
    inventoryMock.mockResolvedValue([{routeId:"webshare-01",identity:"abc1234567",assignedAt:new Date(Date.now()-3600000).toISOString(),assignmentExact:true}]);
    await pg.exec(`insert into shorts_mvp.ingestion_route_slots values('webshare-01',true,null);
      insert into shorts_mvp.video_jobs(id,status,created_at) values('${sid}','completed',now()-interval '2 hours');
      insert into shorts_mvp.ingestion_attempts(job_id,route_id,result) values('${sid}','webshare-01','bot_check');`);
    const [route]=await loadMobileRoutes();
    for(const h of [1,6,24,72]) expect(route.samples[h]).toEqual([0,0]);
    expect(route.consecutiveFailures).toBe(0);
  });
  it("deduplicates IP alerts, links the affected route, and retires replaced or disabled IP incidents", async()=>{
    const assignedAt=new Date(Date.now()-3600000).toISOString();
    inventoryMock.mockResolvedValue([{routeId:"webshare-01",identity:"abc1234567",assignedAt,assignmentExact:true}]);
    await pg.exec(`insert into shorts_mvp.ingestion_route_slots values('webshare-01',true,null);
      insert into shorts_mvp.video_jobs(id,status) values('${sid}','completed');
      insert into shorts_mvp.ingestion_attempts(job_id,route_id,result) select '${sid}','webshare-01','bot_check' from generate_series(1,5);`);
    await scanMobileEvents();await scanMobileEvents();
    let rows=(await pg.query<{payload:{routeId:string},resolved_at:string|null}>("select payload,resolved_at from shorts_mvp.admin_mobile_events where incident_key like 'route:%'")).rows;
    expect(rows).toHaveLength(1);expect(rows[0].payload.routeId).toBe("webshare-01");
    // A bounded historical snapshot can move its known-since timestamp while
    // the current IP stays identical. That must not re-notify the same problem.
    inventoryMock.mockResolvedValue([{routeId:"webshare-01",identity:"abc1234567",assignedAt:new Date(Date.now()-1800000).toISOString(),assignmentExact:false}]);
    expect(await scanMobileEvents()).toMatchObject({ipRoutes:1,ipVerified:1});
    expect((await pg.query("select id from shorts_mvp.admin_mobile_events where incident_key like 'route:%'")).rows).toHaveLength(1);
    inventoryMock.mockResolvedValue([]);await scanMobileEvents();
    expect((await pg.query("select id from shorts_mvp.admin_mobile_events where resolved_at is null")).rows).toHaveLength(1);
    inventoryMock.mockResolvedValue([{routeId:"webshare-01",identity:"new1234567",assignedAt:new Date().toISOString(),assignmentExact:true}]);
    await scanMobileEvents();
    rows=(await pg.query<{payload:{routeId:string},resolved_at:string|null}>("select payload,resolved_at from shorts_mvp.admin_mobile_events where incident_key like 'route:%'")).rows;
    expect(rows[0].resolved_at).not.toBeNull();
    expect((await pg.query("select id from shorts_mvp.admin_mobile_events where kind='recovery'")).rows).toHaveLength(0);
    inventoryMock.mockResolvedValue([{routeId:"webshare-01",identity:"abc1234567",assignedAt,assignmentExact:true}]);
    await pg.exec("update shorts_mvp.ingestion_route_slots set enabled=false");await scanMobileEvents();
    expect((await pg.query("select id from shorts_mvp.admin_mobile_events where resolved_at is null")).rows).toHaveLength(0);
  });
  it("alerts on a poor daily sample even with few hourly attempts and identifies the correct period",async()=>{
    inventoryMock.mockResolvedValue([{routeId:"webshare-01",identity:"abc1234567",assignedAt:new Date(Date.now()-86400000).toISOString(),assignmentExact:true}]);
    await pg.exec(`insert into shorts_mvp.ingestion_route_slots values('webshare-01',true,null);
      insert into shorts_mvp.video_jobs(id,status,created_at) values('${sid}','completed',now()-interval '23 hours');
      insert into shorts_mvp.ingestion_attempts(job_id,route_id,result,created_at)
      select '${sid}','webshare-01','bot_check',now()-interval '2 hours'-i*interval '1 minute' from generate_series(1,30) i;
      insert into shorts_mvp.ingestion_attempts(job_id,route_id,result) values('${sid}','webshare-01','success');`);
    await scanMobileEvents();await scanMobileEvents();
    const {rows}=await pg.query<{payload:{summary:string}}>("select payload from shorts_mvp.admin_mobile_events where incident_key like 'route:%'");
    expect(rows).toHaveLength(1);expect(rows[0].payload.summary).toContain("24시간");expect(rows[0].payload.summary).toContain("1/31");
  });
});
