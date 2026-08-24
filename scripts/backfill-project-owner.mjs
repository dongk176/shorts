import fs from "node:fs";
import path from "node:path";
import postgres from "../web/node_modules/postgres/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const envPath = path.join(root, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] ||= value;
  }
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const apply = process.argv.includes("--apply");
const targetEmail = "dmsthaalcls@gmail.com";
const tables = [
  "video_jobs",
  "generated_shorts",
  "youtube_analyses",
  "usage_reservations",
  "usage_events",
];
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 15,
  prepare: false,
  transform: postgres.camel,
  connection: {
    application_name: "shorts-owner-backfill",
    statement_timeout: 30_000,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: 30_000,
  },
});

async function ownershipCounts(tx, table, userId) {
  const rows = await tx.unsafe(`
    select
      count(*)::int as total,
      count(*) filter (where user_id = $1)::int as target,
      count(*) filter (where user_id is null)::int as unowned,
      count(*) filter (where user_id is not null and user_id <> $1)::int as other
    from shorts_mvp.${table}
  `, [userId]);
  return rows[0];
}

try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('shorts-project-owner-backfill', 0))`;
    const users = await tx`
      select id
      from shorts_mvp.app_users
      where lower(email)=lower(${targetEmail})
      for update
    `;
    if (users.length !== 1) {
      throw new Error(`Expected exactly one app user for ${targetEmail}, found ${users.length}`);
    }
    const userId = users[0].id;
    const before = {};
    for (const table of tables) before[table] = await ownershipCounts(tx, table, userId);

    if (apply) {
      await tx`update shorts_mvp.video_jobs set user_id=${userId} where user_id is null`;
      await tx`update shorts_mvp.generated_shorts set user_id=${userId} where user_id is null`;
      await tx`update shorts_mvp.youtube_analyses set user_id=${userId} where user_id is null`;
      await tx`update shorts_mvp.usage_reservations set user_id=${userId} where user_id is null`;
      await tx`update shorts_mvp.usage_events set user_id=${userId} where user_id is null`;
    }

    const after = {};
    for (const table of tables) after[table] = await ownershipCounts(tx, table, userId);
    if (apply) {
      for (const table of tables) {
        if (after[table].unowned !== 0) throw new Error(`${table} still has unowned rows`);
        if (after[table].other !== before[table].other) throw new Error(`${table} changed another user's rows`);
      }
    }
    return { mode: apply ? "apply" : "dry-run", targetEmail, before, after };
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!apply) process.stdout.write("Dry run only. Re-run with --apply after the authorization deployment is live.\n");
} finally {
  await sql.end({ timeout: 3 });
}
