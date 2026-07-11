import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "../web/node_modules/postgres/src/index.js";

const root = path.resolve(import.meta.dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value;
  }
}

loadEnv(path.join(root, ".env.local"));
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL이 필요합니다. 기존 Supabase direct connection URL을 .env.local에 넣어 주세요.");
}

const migrationPath = path.join(root, "supabase", "migrations", "202607120001_shorts_mvp.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const forbidden = /\b(?:create|alter|drop|truncate)\s+(?:table|view|function|type|schema)\s+(?:if\s+(?:not\s+)?exists\s+)?public\./i;
if (forbidden.test(migration)) throw new Error("migration에서 public schema 변경문을 발견했습니다.");

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 15, idle_timeout: 5 });
const publicObjects = async () => sql`
  select n.nspname as schema_name, c.relname as object_name, c.relkind::text as object_type
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
  union all
  select n.nspname, p.proname, 'function'
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
  order by 2,3
`;

try {
  const before = JSON.stringify(await publicObjects());
  await sql.unsafe(migration, [], { prepare: false });
  const after = JSON.stringify(await publicObjects());
  if (before !== after) throw new Error("migration 적용 중 public schema 객체가 변경되었습니다.");
  const plans = await sql`
    select code, monthly_source_seconds, retention_days
    from shorts_mvp.plans order by sort_order
  `;
  const expected = ["plus:6000:30", "standard:18000:30", "pro:36000:30"];
  const actual = plans.map((plan) => `${plan.code}:${plan.monthlySourceSeconds}:${plan.retentionDays}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("plan seed 검증에 실패했습니다.");
  process.stdout.write("Supabase shorts_mvp migration 및 public schema 무변경 검증 완료\n");
} finally {
  await sql.end({ timeout: 3 });
}
