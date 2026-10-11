import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { japaneseQuotaVerified } from "./youtube-quota";
vi.mock("server-only", () => ({}));
let pg: PGlite;
const migrations = ["202607140004_popular_video_snapshots", "202607140005_remove_unavailable_popular_categories",
  "202607150006_free_video_snapshots", "202607150007_popular_search_snapshots", "202607150009_korean_video_filter",
  "202609090001_youtube_discovery_catalog", "202609110001_youtube_quota_opening_balances",
  "202609110002_youtube_pending_metadata", "202609110003_youtube_collection_recency",
  "202609110010_youtube_japan_discovery", "202609110011_youtube_japan_quota",
  "202609110012_youtube_japan_activation_constraints", "20261011085148_youtube_japan_continuous_collection"];
const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const { rows } = await pg.query<Record<string, unknown>>(strings.reduce((s, part, i) => s + (i ? `$${i}` : "") + part, ""), values);
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),v])));
}) as unknown as Sql;
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create schema shorts_mvp; create role anon; create role authenticated; create role service_role;
    create table shorts_mvp.popular_filter_usage_events(id uuid primary key);
    create table shorts_mvp.youtube_analyses(id uuid primary key,expires_at timestamptz);
    create table shorts_mvp.site_metrics(key text primary key,value bigint,updated_at timestamptz);`);
  for (const name of migrations) await pg.exec(readFileSync(`../supabase/migrations/${name}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  vi.stubEnv("YOUTUBE_QUOTA_PROJECT_ID", "test-project"); vi.stubEnv("YOUTUBE_API_KEY", "test-key");
  await pg.exec("truncate shorts_mvp.youtube_quota_attempts, shorts_mvp.youtube_quota_verifications cascade;");
  await pg.query(`insert into shorts_mvp.youtube_quota_verifications(project_id,key_fingerprint,search_daily_limit,general_daily_limit,
    other_clients_reviewed,verified_at,evidence,accounting_ready_from,japan_collection_enabled,japan_discovery_enabled,
    japan_activated_at,japan_verified_at,japan_evidence,japan_search_daily_ceiling)
    values('test-project',$1,100,10000,true,now()-interval '30 days','initial verified quota',current_date-40,true,true,
      now()-interval '30 days',now()-interval '30 days','verified Japan allocation',100)`, [createHash("sha256").update("test-key").digest("hex")]);
});
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });
const reserve = async (region: string, bucket: string, purpose: string, units: number) =>
  (await pg.query<{ id: string | null }>("select shorts_mvp.reserve_youtube_region_quota('test-project',$1,$2,$3,$4) id", [bucket,purpose,units,region])).rows[0].id;
it("continues an unchanged verified allocation after seven days without rewriting its evidence date", async () => {
  expect(await japaneseQuotaVerified(sql)).toEqual({ searchEnabled: true });
  expect(await reserve("JP", "general", "trending", 7)).toBeTruthy();
  expect((await pg.query<{ old: boolean }>("select japan_verified_at<now()-interval '7 days' as old from shorts_mvp.youtube_quota_verifications")).rows[0].old).toBe(true);
});
it("preserves KR 90/JP 10 search allocation and Japan 17 general limit", async () => {
  for (const [region, purpose, units] of [["JP","reusable",7],["JP","views",3],["KR","views",40],["KR","reusable",20],["KR","free",30]] as const)
    expect(await reserve(region,"search",purpose,units)).toBeTruthy();
  expect(await reserve("JP","search","views",1)).toBeNull();
  expect(await reserve("KR","search","free",1)).toBeNull();
  for (const [purpose, units] of [["trending",7],["reusable",7],["views",3]] as const)
    expect(await reserve("JP","general",purpose,units)).toBeTruthy();
  expect(await reserve("JP","general","views",1)).toBeNull();
});
it.each(["japan_verified_at=null", "japan_evidence=''", "japan_collection_enabled=false", "japan_activated_at=null", "general_daily_limit=9000", "other_clients_reviewed=false"])("still fails closed when %s", async condition => {
  await pg.exec(`update shorts_mvp.youtube_quota_verifications set ${condition}`);
  expect(await reserve("JP","general","trending",1)).toBeNull();
});
it("rejects a changed API key before collection", async () => {
  vi.stubEnv("YOUTUBE_API_KEY", "changed-key");
  expect(await japaneseQuotaVerified(sql)).toBeNull();
});
