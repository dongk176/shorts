import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Sql } from "postgres";
import { PGlite } from "../../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
vi.mock("server-only", () => ({}));
import { TikTokApi } from "./api";
import { TikTokStore } from "./store";
import { TikTokVault } from "./vault";
import { TikTokMedia } from "@/test-tools/tiktok-local-media";
import { TikTokPublishing } from "./service";
import { tiktokConfig } from "./config";
import { emptyTikTokIntent } from "../review-contract";

const A = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "review-session-a" };
const B = { userId: "22222222-2222-4222-8222-222222222222", sessionId: "review-session-b" };
const shortId = "33333333-3333-4333-8333-333333333333", otherShort = "44444444-4444-4444-8444-444444444444";
const jobA = "55555555-5555-4555-8555-555555555555", jobB = "66666666-6666-4666-8666-666666666666";
const config = tiktokConfig({ NODE_ENV: "test", TIKTOK_PUBLISHING_MODE: "local", DATABASE_URL: "postgres://test@127.0.0.1:5432/isolated", TIKTOK_ALLOWED_USER_IDS: A.userId, TIKTOK_PUBLIC_ORIGIN: "https://review.example.test", TIKTOK_CLIENT_KEY: "test-client", TIKTOK_CLIENT_SECRET: "test-client-secret", TIKTOK_MEDIA_ORIGIN_VERIFIED: "true" });
let pg: PGlite, store: TikTokStore, service: TikTokPublishing, media: TikTokMedia, root: string;
const vault = new TikTokVault(Buffer.alloc(32, 9), config.clientKey);
let paid = true, partial = false, creatorPrivateOnly = false, status = "PROCESSING_DOWNLOAD", initError = "", loseInit = false, creatorError = "", revokeFails = false;
let initCalls = 0, refreshCalls = 0, revokes = 0, creatorCalls = 0, lastInit: Record<string, unknown>, lastUrl = "";
function tag(engine: Pick<PGlite, "query">): Sql {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((out, part, index) => out+(index ? `$${index}` : "")+part, "");
    const result = await engine.query<Record<string, unknown>>(text, values);
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value])));
  };
  return Object.assign(sql, { begin: (fn: (tx: Sql) => Promise<unknown>) => pg.transaction(tx => fn(tag(tx))) }) as unknown as Sql;
}
const tokens = (rotated = false) => ({ access_token: rotated ? "rotated-access" : "private-access", refresh_token: rotated ? "rotated-refresh" : "private-refresh", open_id: "owned-open-id", scope: partial ? "user.info.basic" : "user.info.basic,video.publish", expires_in: 86_400, refresh_expires_in: 31_536_000 });
const fetcher: typeof fetch = async (url, init) => {
  expect(init?.redirect).toBe("error"); expect(init?.signal).toBeDefined();
  expect(String(url).startsWith("https://open.tiktokapis.com/v2/")).toBe(true);
  const path = String(url);
  if (path.endsWith("oauth/revoke/")) { revokes++; return revokeFails ? Response.json({ error: "bad" }, { status: 500 }) : Response.json({}); }
  if (path.endsWith("oauth/token/")) {
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("client_secret")).toBe("test-client-secret");
    expect(body.has("code_verifier")).toBe(false);
    if (body.get("grant_type") === "refresh_token") { refreshCalls++; return Response.json(tokens(true)); }
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
    return Response.json(tokens());
  }
  if (path.endsWith("creator_info/query/")) {
    creatorCalls++;
    if (creatorError) return Response.json({ error: { code: creatorError, message: "private-provider-text" } });
    return Response.json({ data: { creator_username: "owner", creator_nickname: "My TikTok", privacy_level_options: creatorPrivateOnly ? ["SELF_ONLY"] : ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], comment_disabled: true, duet_disabled: true, stitch_disabled: true, max_video_post_duration_sec: 60 }, error: { code: "ok" } });
  }
  if (path.endsWith("video/init/")) {
    initCalls++; lastInit = JSON.parse(String(init?.body)); lastUrl = (lastInit.source_info as { video_url: string }).video_url;
    if (loseInit) throw new Error("response lost after accepted");
    if (initError) return Response.json({ error: { code: initError, message: "private-provider-text" } }, { status: 403 });
    return Response.json({ data: { publish_id: "v_pub_url~123" }, error: { code: "ok" } });
  }
  expect(path).toContain("status/fetch/");
  return Response.json({ data: { status, ...(status === "FAILED" ? { fail_reason: "video_pull_failed" } : {}) }, error: { code: "ok" } });
};
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema shorts_mvp;
    create table shorts_mvp.app_users(id uuid primary key, withdrawn_at timestamptz);
    create table shorts_mvp.video_jobs(id uuid primary key,user_id uuid,project_number integer,status text,is_example boolean,user_deleted_at timestamptz);
    create table shorts_mvp.generated_shorts(id uuid primary key,job_id uuid,user_id uuid,status text,deleted_at timestamptz,expires_at timestamptz,output_s3_key text,render_version integer);
    set app.tiktok_admin_review='true';`);
  await pg.exec(fs.readFileSync(path.resolve("../supabase/migrations/202609210001_tiktok_admin_publishing.sql"), "utf8"));
  await pg.exec(fs.readFileSync(path.resolve("../supabase/migrations/20261009053238_tiktok_public_privacy.sql"), "utf8"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "easycut-tiktok-")); fs.mkdirSync(path.join(root, "outputs")); fs.writeFileSync(path.join(root, "outputs/owned.mp4"), Buffer.alloc(64, 1));
}, 30_000);
beforeEach(async () => {
  await pg.exec(`truncate shorts_mvp.app_users,shorts_mvp.generated_shorts,shorts_mvp.video_jobs cascade;
    insert into shorts_mvp.app_users values('${A.userId}',null),('${B.userId}',null);
    insert into shorts_mvp.video_jobs values('${jobA}','${A.userId}',1,'complete',false,null),('${jobB}','${B.userId}',2,'complete',false,null);
    insert into shorts_mvp.generated_shorts values('${shortId}','${jobA}','${A.userId}','ready',null,null,'outputs/owned.mp4',1),('${otherShort}','${jobB}','${B.userId}','ready',null,null,'outputs/other.mp4',1);`);
  config.auditApproved = false;
  paid = true; partial = false; creatorPrivateOnly = false; status = "PROCESSING_DOWNLOAD"; initError = ""; creatorError = ""; loseInit = false; revokeFails = false;
  initCalls = 0; refreshCalls = 0; revokes = 0; creatorCalls = 0; lastUrl = "";
  fs.writeFileSync(path.join(root, "outputs/owned.mp4"), Buffer.alloc(64, 1));
  store = new TikTokStore(tag(pg), config.clientKey); media = new TikTokMedia(root);
  // Only the media probe is stubbed here; path containment/fingerprints and SQL
  // constraints execute for real. A separate test exercises the actual probe.
  vi.spyOn(media, "inspect").mockImplementation(async key => { const file = await media.file(key); return { ...file, duration: 15, hash: await media.fingerprint(file.file) }; });
  service = new TikTokPublishing(store, vault, new TikTokApi(config, fetcher), media, config, async () => { if (!paid) throw Error("Paid access required"); });
});
afterAll(async () => { await pg.close(); fs.rmSync(root, { recursive: true, force: true }); });
async function start(actor = A) { return new URL(await service.start(actor, { returnPath: "/en/publish/channels" })).searchParams.get("state")!; }
async function connect() { const state = await start(); expect((await service.callback(A, new URLSearchParams({ state, code: "review-code" }))).outcome).toBe("connected"); return (await service.list(A)).connections[0]; }
const intent = (id: string) => ({ ...emptyTikTokIntent(id), privacy: "SELF_ONLY", shortId, title: "My original video", musicUsageConfirmed: true, sendToTikTokConfirmed: true, rightsConfirmed: true, isAigc: false });
const capability = () => new URL(lastUrl).pathname.split("/").at(-1)!;

describe("TikTok local publishing through PostgreSQL and provider protocol", () => {
  it("binds OAuth to the app user/session, rejects replay and keeps exact locale return", async () => {
    const state = await start();
    await expect(service.callback(B, new URLSearchParams({ state, code: "wrong" }))).rejects.toThrow();
    await expect(service.callback({ ...A, sessionId: "wrong-session" }, new URLSearchParams({ state, code: "wrong" }))).rejects.toThrow();
    expect(await service.callback(A, new URLSearchParams({ state, code: "right" }))).toEqual({ outcome: "connected", returnPath: "/en/publish/channels" });
    await expect(service.callback(A, new URLSearchParams({ state, code: "replay" }))).rejects.toThrow();
    const raw = (await pg.query<{ token_ciphertext: string }>("select token_ciphertext from shorts_mvp.tiktok_connections")).rows[0].token_ciphertext;
    expect(raw).not.toMatch(/private-access|private-refresh/);
    expect(() => vault.open(raw, B.userId, "connection:owned-open-id")).toThrow();
    expect(() => new TikTokVault(Buffer.alloc(32, 9), "other-app").open(raw, A.userId, "connection:owned-open-id")).toThrow();
    expect(JSON.stringify(await service.list(A))).not.toMatch(/token|cipher|openId|secret/);
    expect((await service.list(B)).connections).toEqual([]);
  });
  it("rejects partial grants, cancellations, expired states and arbitrary redirects", async () => {
    partial = true;
    expect((await service.callback(A, new URLSearchParams({ state: await start(), code: "x" }))).outcome).toBe("failed");
    expect(revokes).toBe(1); expect((await service.list(A)).connections).toEqual([]);
    expect((await service.callback(A, new URLSearchParams({ state: await start(), error: "access_denied" }))).outcome).toBe("cancelled");
    const expired = await start(); await pg.exec("update shorts_mvp.tiktok_oauth set expires_at=now()-interval '1 second'");
    await expect(service.callback(A, new URLSearchParams({ state: expired, code: "x" }))).rejects.toThrow();
    for (const returnPath of ["//evil.test", "https://evil.test", "/en/projects/1?next=x", "/settings#x"]) await expect(service.start(A, { returnPath })).rejects.toThrow();
    await expect(service.start(A, { returnPath: "/projects/2", shortId })).rejects.toThrow();
  });
  it("checks owner, paid access, current creator limits and explicit consent before any init", async () => {
    const c = await connect();
    await expect(service.create(B, intent(c.id))).rejects.toThrow();
    await expect(service.create(A, { ...intent(c.id), shortId: otherShort })).rejects.toThrow();
    paid = false; await expect(service.create(A, intent(c.id))).rejects.toThrow(); paid = true;
    for (const change of [{ privacy: "PUBLIC_TO_EVERYONE" }, { privacy: null }, { allowComments: true }, { allowDuet: true }, { allowStitch: true }, { rightsConfirmed: false }, { sendToTikTokConfirmed: false }, { discloseCommercialContent: true }, { brandedContent: true, discloseCommercialContent: true }]) {
      await expect(service.create(A, { ...intent(c.id), ...change })).rejects.toThrow();
    }
    creatorError = "spam_risk_too_many_posts";
    await expect(service.create(A, intent(c.id))).rejects.toThrow(); expect(initCalls).toBe(0);
  });
  it("publishes the chosen public audience only after approval and preserves ownership and consent checks", async () => {
    const c = await connect();
    config.auditApproved = true;
    expect((await service.creator(A, c.id, shortId)).auditApproved).toBe(true);
    const publicIntent = { ...intent(c.id), privacy: "PUBLIC_TO_EVERYONE" };
    await expect(service.create(B, publicIntent)).rejects.toThrow();
    await expect(service.create(A, { ...publicIntent, sendToTikTokConfirmed: false })).rejects.toThrow();
    creatorPrivateOnly = true;
    await expect(service.create(A, publicIntent)).rejects.toThrow();
    creatorPrivateOnly = false;
    const posted = await service.create(A, publicIntent);
    expect(posted).toMatchObject({ status: "processing", privacy: "PUBLIC_TO_EVERYONE" });
    expect(lastInit).toMatchObject({ post_info: { privacy_level: "PUBLIC_TO_EVERYONE" } });
    expect((await service.listPosts(A, shortId))[0].privacy).toBe("PUBLIC_TO_EVERYONE");
    expect((await service.create(A, publicIntent)).id).toBe(posted.id);
    expect(initCalls).toBe(1);
  });
  it("stores the new audience when retrying a pre-approval rejection after approval", async () => {
    const c = await connect(); initError = "unaudited_client_can_only_post_to_private_accounts";
    const failed = await service.create(A, intent(c.id));
    initError = ""; config.auditApproved = true;
    const posted = await service.create(A, { ...intent(c.id), privacy: "PUBLIC_TO_EVERYONE" });
    expect(posted.id).not.toBe(failed.id);
    expect(posted).toMatchObject({ privacy: "PUBLIC_TO_EVERYONE", status: "processing" });
    expect(initCalls).toBe(2);
  });
  it("uses verified PULL_FROM_URL, stores consent, and never uploads twice for a render", async () => {
    const c = await connect(), before = creatorCalls;
    const result = await service.create(A, intent(c.id));
    expect(result.status).toBe("processing"); expect(creatorCalls).toBe(before+1);
    expect(lastInit).toMatchObject({ post_info: { title: "My original video", privacy_level: "SELF_ONLY", disable_comment: true, disable_duet: true, disable_stitch: true, brand_content_toggle: false, brand_organic_toggle: false }, source_info: { source: "PULL_FROM_URL" } });
    expect(lastUrl.startsWith(config.publicOrigin+"/api/social/tiktok/media/")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/publishId|private-|media_hash|sourceKey/);
    expect((await service.create(A, { ...intent(c.id), title: "edited retry" })).id).toBe(result.id); expect(initCalls).toBe(1);
    expect((await service.publicMedia(capability())).file).toBe(fs.realpathSync(path.join(root, "outputs/owned.mp4")));
    await expect(service.publicMedia("guessed")).rejects.toThrow();
    status = "PUBLISH_COMPLETE"; await pg.exec("update shorts_mvp.tiktok_posts set checked_at=now()-interval '10 seconds'");
    expect((await service.check(A, result.id)).status).toBe("complete");
    await expect(service.publicMedia(capability())).rejects.toThrow();
    expect((await service.create(A, intent(c.id))).status).toBe("complete"); expect(initCalls).toBe(1);
  });
  it("records an uncertain init result without unsafe resend after response loss", async () => {
    const c = await connect(); loseInit = true;
    const result = await service.create(A, intent(c.id)); expect(result.status).toBe("unknown");
    expect((await service.create(A, intent(c.id))).id).toBe(result.id);
    expect((await service.check(A, result.id)).status).toBe("unknown"); expect(initCalls).toBe(1);
  });
  it("reports provider rejections and process failures without leaking provider messages", async () => {
    const c = await connect(); initError = "unaudited_client_can_only_post_to_private_accounts";
    const result = await service.create(A, intent(c.id));
    expect(result).toMatchObject({ status: "failed", errorCode: "TIKTOK_UNAUDITED_CLIENT_CAN_ONLY_POST_TO_PRIVATE_ACCOUNTS" });
    expect(JSON.stringify(result)).not.toContain("private-provider-text");
    await expect(service.publicMedia(capability())).rejects.toThrow();
  });
  it("lets the user resubmit after a public-account rejection with fresh consent and media access", async () => {
    const c = await connect(); initError = "unaudited_client_can_only_post_to_private_accounts";
    const rejected = await service.create(A, intent(c.id)), oldCapability = capability();
    await pg.exec("update shorts_mvp.tiktok_posts set media_expires_at=now()-interval '1 second'");
    initError = ""; creatorPrivateOnly = true;
    await expect(service.create(B, intent(c.id))).rejects.toThrow();
    await expect(service.create(A, { ...intent(c.id), rightsConfirmed: false })).rejects.toThrow();
    expect(initCalls).toBe(1);
    const updated = { ...intent(c.id), title: "Private account retry" };
    const retried = await service.create(A, updated);
    expect(retried).toMatchObject({ status: "processing", title: updated.title, errorCode: null });
    expect(retried.id).not.toBe(rejected.id); expect(initCalls).toBe(2);
    await expect(service.publicMedia(oldCapability)).rejects.toThrow();
    await expect(service.publicMedia(capability())).resolves.toHaveProperty("file");
    const row = (await pg.query<{ consent_ciphertext: string; fresh: boolean }>("select consent_ciphertext,media_expires_at>now() as fresh from shorts_mvp.tiktok_posts")).rows[0];
    expect(row.fresh).toBe(true);
    expect(JSON.parse(vault.open(row.consent_ciphertext, A.userId, `consent:${retried.id}`))).toMatchObject({ input: updated, creator: { privacyOptions: ["SELF_ONLY"] } });
    expect((await service.create(A, updated)).id).toBe(retried.id); expect(initCalls).toBe(2);
  });
  it("allows only one concurrent retry after the public-account setting is corrected", async () => {
    const c = await connect(); initError = "unaudited_client_can_only_post_to_private_accounts";
    await service.create(A, intent(c.id)); initError = ""; creatorPrivateOnly = true;
    const results = await Promise.all([service.create(A, intent(c.id)), service.create(A, intent(c.id))]);
    expect(results[0].id).toBe(results[1].id); expect(initCalls).toBe(2);
  });
  it("does not resend a failed post that TikTok already accepted or rejected for another reason", async () => {
    const c = await connect(); initError = "spam_risk_too_many_posts";
    const rejected = await service.create(A, intent(c.id)); initError = "";
    expect((await service.create(A, intent(c.id))).id).toBe(rejected.id); expect(initCalls).toBe(1);
    await pg.exec("update shorts_mvp.tiktok_posts set error_code='TIKTOK_UNAUDITED_CLIENT_CAN_ONLY_POST_TO_PRIVATE_ACCOUNTS',publish_id='accepted-post'");
    expect((await service.create(A, intent(c.id))).id).toBe(rejected.id); expect(initCalls).toBe(1);
  });
  it("rotates tokens, saves rotation despite a later error, and marks invalid grants for reconnect", async () => {
    const c = await connect();
    const encrypted = vault.seal(JSON.stringify({ accessToken: "old", refreshToken: "old-refresh", openId: "owned-open-id", accessExpiresAt: 1, refreshExpiresAt: Date.now()+100_000, scopes: ["user.info.basic", "video.publish"] }), A.userId, "connection:owned-open-id");
    await pg.query("update shorts_mvp.tiktok_connections set token_ciphertext=$1", [encrypted]);
    creatorError = "rate_limit_exceeded"; await expect(service.creator(A, c.id, shortId)).rejects.toThrow();
    creatorError = ""; await service.creator(A, c.id, shortId); expect(refreshCalls).toBe(1);
    creatorError = "access_token_invalid"; await expect(service.creator(A, c.id, shortId)).rejects.toThrow();
    expect((await service.list(A)).connections[0].status).toBe("reconnect_required");
  });
  it("disconnect deletes credentials/history, fences late callbacks and stops media access", async () => {
    const c = await connect(); await service.create(A, intent(c.id));
    const state = await start(), pending = await store.consume(A, state);
    revokeFails = true;
    expect(await service.disconnect(A, c.id)).toMatchObject({ deleted: true, revocation: "manual_required" });
    expect((await service.list(A)).connections).toEqual([]); expect(await service.listPosts(A, shortId)).toEqual([]);
    await expect(service.publicMedia(capability())).rejects.toThrow();
    await expect(store.finish(pending, { openId: "owned-open-id", nickname: "late", username: "late", ciphertext: "late" })).rejects.toThrow();
    await expect(start()).rejects.toMatchObject({ code: "TIKTOK_RECONNECT_WAIT" });
  });
  it("revokes a late OAuth exchange that was invalidated by disconnect", async () => {
    const c = await connect(), state = await start();
    const lateApi = new TikTokApi(config, async (url, init) => {
      if (String(url).endsWith("oauth/token/")) await service.disconnect(A, c.id);
      return fetcher(url, init);
    });
    const late = new TikTokPublishing(store, vault, lateApi, media, config, async () => {});
    expect((await late.callback(A, new URLSearchParams({ state, code: "late" }))).outcome).toBe("failed");
    expect((await service.list(A)).connections).toEqual([]); expect(revokes).toBe(2);
  });
  it("invalidates expired capabilities and changed output bytes/render versions", async () => {
    const c = await connect(); await service.create(A, intent(c.id));
    fs.writeFileSync(path.join(root, "outputs/owned.mp4"), Buffer.alloc(64, 2));
    await expect(service.publicMedia(capability())).rejects.toThrow();
    fs.writeFileSync(path.join(root, "outputs/owned.mp4"), Buffer.alloc(64, 1));
    await pg.exec("update shorts_mvp.tiktok_posts set media_expires_at=now()-interval '1 second'");
    await expect(service.publicMedia(capability())).rejects.toThrow();
    await pg.exec("update shorts_mvp.tiktok_posts set media_expires_at=now()+interval '1 hour'; update shorts_mvp.generated_shorts set render_version=2");
    await expect(service.publicMedia(capability())).rejects.toThrow();
  });
  it("erases social data in the withdrawal transaction and rolls back on failure", async () => {
    const c = await connect();
    await expect(store.db.begin(async tx => { await store.removeForWithdrawal(tx, A.userId); throw Error("withdraw failed"); })).rejects.toThrow();
    expect((await service.list(A)).connections).toHaveLength(1);
    const removed = await store.db.begin(async tx => {
      const links = await store.removeForWithdrawal(tx, A.userId);
      await tx`update shorts_mvp.app_users set withdrawn_at=now() where id=${A.userId}`;
      return links;
    });
    expect(await service.revokeRemoved(A.userId, removed as never)).toBe("revoked");
    await expect(service.creator(A, c.id, shortId)).rejects.toThrow(); expect((await service.list(A)).connections).toEqual([]);
  });
});
