import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { PGlite } from "../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { HttpError } from "./http";
import { saveConversionEvent } from "./conversion-events-store";
import type { ConversionEvent } from "./conversion-events";
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: vi.fn() }));
import { getDb } from "./db";
import { requireAuthenticatedMvpSession } from "./session";
import { POST } from "@/app/api/conversion-events/route";

let pg: PGlite;
let db: Sql;
const userId = randomUUID();
function event(): ConversionEvent { return { id: randomUUID(), name: "pricing_viewed", locale: "ja", surface: "pricing" }; }
function request(body: unknown, origin = "https://www.easycut.co.kr") {
  return new Request("https://www.easycut.co.kr/api/conversion-events", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "x-vercel-ip-country": "JP" }, body: JSON.stringify(body) });
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec("create schema shorts_mvp; create role anon; create role authenticated; create role service_role bypassrls; create table shorts_mvp.app_users(id uuid primary key,withdrawn_at timestamptz);");
  await pg.exec(readFileSync("../supabase/migrations/20261109013451_conversion_events.sql", "utf8"));
  await pg.query("insert into shorts_mvp.app_users(id) values ($1)", [userId]);
  db = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, "");
    return (await pg.query(sql, values)).rows;
  }) as unknown as Sql;
}, 30_000);
beforeEach(async () => {
  vi.clearAllMocks();
  await pg.exec("truncate shorts_mvp.conversion_events");
  vi.mocked(getDb).mockReturnValue(db);
  vi.mocked(requireAuthenticatedMvpSession).mockResolvedValue({ id: randomUUID(), userId, user: null, selectedPlanCode: "free" });
});
afterAll(async () => { await pg.close(); });

describe("authenticated funnel storage in isolated PostgreSQL", () => {
  it("binds events to the authenticated account, stores country, and deduplicates retries", async () => {
    const e = event();
    expect((await POST(request(e))).status).toBe(200);
    expect((await POST(request(e))).status).toBe(200);
    const rows = (await pg.query("select user_id,event_name,locale,country from shorts_mvp.conversion_events")).rows;
    expect(rows).toEqual([{ user_id: userId, event_name: "pricing_viewed", locale: "ja", country: "JP" }]);
  });
  it.each([{ userId: randomUUID() }, { email: "test@example.com" }, { url: "https://example.com/video" }, { name: "download_requested" }])("rejects forged ownership, extra data and client download claims %j", async (extra) => {
    expect((await POST(request({ ...event(), ...extra }))).status).toBe(400);
    expect(vi.mocked(requireAuthenticatedMvpSession)).not.toHaveBeenCalled();
  });
  it("requires authentication and same origin", async () => {
    expect((await POST(request(event(), "https://example.com"))).status).toBe(403);
    vi.mocked(requireAuthenticatedMvpSession).mockRejectedValue(new HttpError(401, "Login required"));
    expect((await POST(request(event()))).status).toBe(401);
    expect((await pg.query("select * from shorts_mvp.conversion_events")).rows).toHaveLength(0);
  });
  it("bounds request size even without Content-Length", async () => {
    expect((await POST(request({ ...event(), payload: "x".repeat(2048) }))).status).toBe(413);
  });
  it("persists server download requests and does not retain invalid country text", async () => {
    await saveConversionEvent(db, userId, { ...event(), name: "download_requested", surface: "short_download" }, "invalid");
    expect((await pg.query("select event_name,country from shorts_mvp.conversion_events")).rows).toEqual([{ event_name: "download_requested", country: null }]);
  });
  it("enables RLS and denies browser roles direct access", async () => {
    const rows = (await pg.query("select relrowsecurity from pg_class where oid='shorts_mvp.conversion_events'::regclass")).rows;
    expect(rows).toEqual([{ relrowsecurity: true }]);
    expect((await pg.query("select has_table_privilege('anon','shorts_mvp.conversion_events','select') as can_read,has_table_privilege('authenticated','shorts_mvp.conversion_events','insert') as can_write")).rows).toEqual([{ can_read: false, can_write: false }]);
  });
  it("rejects events for withdrawn accounts", async () => {
    const withdrawn = randomUUID();
    await pg.query("insert into shorts_mvp.app_users(id,withdrawn_at) values ($1,now())", [withdrawn]);
    await saveConversionEvent(db, withdrawn, event());
    expect((await pg.query("select * from shorts_mvp.conversion_events")).rows).toHaveLength(0);
  });
});
