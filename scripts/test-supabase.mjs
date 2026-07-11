import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "../web/node_modules/postgres/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] ||= value;
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for live Supabase tests");

const sql = postgres(process.env.DATABASE_URL, { max: 1, transform: postgres.camel });
const sessionId = crypto.randomUUID();
const jobId = crypto.randomUUID();
try {
  const plans = await sql`select code, monthly_source_seconds from shorts_mvp.plans order by sort_order`;
  assert.deepEqual(plans.map((row) => [row.code, row.monthlySourceSeconds]), [
    ["plus", 6000], ["standard", 18000], ["pro", 36000],
  ]);
  await sql`
    insert into shorts_mvp.mvp_sessions (id,token_hash)
    values (${sessionId},${crypto.createHash("sha256").update(sessionId).digest("hex")})
  `;
  await sql`
    insert into shorts_mvp.video_jobs (
      id,mvp_session_id,request_id,youtube_url,youtube_video_id,video_title,channel_name,
      thumbnail_url,source_duration_seconds,range_start_seconds,range_end_seconds,
      template_id,clip_length_option,
      expected_short_count,rights_confirmed
    ) values (
      ${jobId},${sessionId},${crypto.randomUUID()},'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'dQw4w9WgXcQ','integration','channel','https://example.com/thumb.jpg',3600,0,3600,
      'dark-red','sec_30',5,true
    )
  `;
  await sql`
    insert into shorts_mvp.usage_reservations (mvp_session_id,job_id,source_duration_seconds)
    values (${sessionId},${jobId},3600)
  `;
  let reservation = await sql`select status,source_duration_seconds from shorts_mvp.usage_reservations where job_id=${jobId}`;
  assert.deepEqual([reservation[0].status, reservation[0].sourceDurationSeconds], ["reserved", 3600]);
  await sql`update shorts_mvp.mvp_sessions set selected_plan_code='pro' where id=${sessionId}`;
  reservation = await sql`select status,source_duration_seconds from shorts_mvp.usage_reservations where job_id=${jobId}`;
  assert.equal(reservation[0].sourceDurationSeconds, 3600);
  await sql.begin(async (tx) => {
    await tx`update shorts_mvp.usage_reservations set status='consumed',consumed_at=now() where job_id=${jobId}`;
    await tx`
      insert into shorts_mvp.usage_events (mvp_session_id,job_id,event_type,source_duration_seconds)
      values (${sessionId},${jobId},'source_consumed',3600)
      on conflict (job_id,event_type) do nothing
    `;
    await tx`
      insert into shorts_mvp.usage_events (mvp_session_id,job_id,event_type,source_duration_seconds)
      values (${sessionId},${jobId},'source_consumed',3600)
      on conflict (job_id,event_type) do nothing
    `;
  });
  const usage = await sql`select count(*)::int as count,sum(source_duration_seconds)::int as seconds from shorts_mvp.usage_events where job_id=${jobId}`;
  assert.deepEqual([usage[0].count, usage[0].seconds], [1, 3600]);
  const publicObjects = await sql`
    select count(*)::int as count from information_schema.tables
    where table_schema='public' and table_name like 'shorts_mvp%'
  `;
  assert.equal(publicObjects[0].count, 0);
  process.stdout.write("Supabase plan/reservation/consume/idempotency/public-schema live tests passed\n");
} finally {
  await sql`delete from shorts_mvp.mvp_sessions where id=${sessionId}`.catch(() => undefined);
  await sql.end({ timeout: 3 });
}
