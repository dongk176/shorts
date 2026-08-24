import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "../web/node_modules/postgres/src/index.js";

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] ||= value;
  }
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 15,
  idle_timeout: 5,
  transform: postgres.camel,
});

const eligibleCte = `
  with eligible_subscriptions as (
    select
      s.id as subscription_id,
      s.user_id,
      s.plan_code,
      p.monthly_source_seconds
    from shorts_mvp.user_subscriptions s
    join shorts_mvp.plans p on p.code=s.plan_code
    where s.status='active'
      and s.plan_code<>'free'
      and p.monthly_source_seconds>0
      and s.current_period_start<=timestamptz '2026-07-28 15:00:00+09'
      and s.current_period_end>timestamptz '2026-07-28 15:00:00+09'
      and exists (
        select 1
        from shorts_mvp.billing_orders o
        where o.subscription_id=s.id
          and o.status='succeeded'
          and o.amount_krw>0
          and o.approved_at<timestamptz '2026-07-28 15:00:00+09'
          and o.kind in (
            'subscription_initial',
            'subscription_renewal',
            'subscription_change',
            'annual_renewal'
          )
      )
  )
`;

try {
  const eligibilityByPlan = await sql.unsafe(`
    ${eligibleCte}
    select
      plan_code,
      count(*)::integer as subscriptions,
      count(distinct user_id)::integer as users,
      sum(monthly_source_seconds)::bigint as eligible_seconds
    from eligible_subscriptions
    group by plan_code
    order by plan_code
  `);
  const [eligibility] = await sql.unsafe(`
    ${eligibleCte}
    select
      count(*)::integer as subscriptions,
      count(distinct user_id)::integer as users,
      coalesce(sum(monthly_source_seconds),0)::bigint as eligible_seconds
    from eligible_subscriptions
  `);
  const [announcementTable] = await sql`
    select to_regclass('shorts_mvp.member_campaign_announcements') is not null as exists
  `;
  const [grants] = await sql`
    select
      count(*)::integer as subscriptions,
      count(distinct user_id)::integer as users,
      coalesce(sum(total_seconds),0)::bigint as granted_seconds
    from shorts_mvp.usage_grants
    where product_code='editor_launch_bonus_20260728'
  `;

  let invariants = null;
  let announcements = null;
  if (announcementTable.exists) {
    [invariants] = await sql.unsafe(`
      ${eligibleCte},
      bonus_grants as (
        select subscription_id,user_id,total_seconds
        from shorts_mvp.usage_grants
        where product_code='editor_launch_bonus_20260728'
      ),
      expected_announcements as (
        select user_id,sum(total_seconds)::integer as granted_seconds
        from bonus_grants
        group by user_id
      )
      select
        (
          select count(*)::integer
          from eligible_subscriptions e
          left join bonus_grants g on g.subscription_id=e.subscription_id
          where g.subscription_id is null
        ) as missing_grants,
        (
          select count(*)::integer
          from bonus_grants g
          left join eligible_subscriptions e on e.subscription_id=g.subscription_id
          where e.subscription_id is null
        ) as unexpected_grants,
        (
          select count(*)::integer
          from bonus_grants g
          join eligible_subscriptions e on e.subscription_id=g.subscription_id
          where g.user_id<>e.user_id
            or g.total_seconds<>e.monthly_source_seconds
        ) as mismatched_grants,
        (
          select count(*)::integer
          from expected_announcements e
          left join shorts_mvp.member_campaign_announcements a
            on a.user_id=e.user_id
            and a.campaign_code='editor_launch_20260728'
          where a.id is null or a.granted_seconds<>e.granted_seconds
        ) as missing_or_mismatched_announcements,
        (
          select count(*)::integer
          from shorts_mvp.member_campaign_announcements a
          left join expected_announcements e on e.user_id=a.user_id
          where a.campaign_code='editor_launch_20260728'
            and e.user_id is null
        ) as unexpected_announcements
    `);
    [announcements] = await sql`
      select
        count(*)::integer as users,
        count(*) filter (where presented_at is null)::integer as pending,
        count(*) filter (where presented_at is not null)::integer as presented,
        coalesce(sum(granted_seconds),0)::bigint as announced_seconds
      from shorts_mvp.member_campaign_announcements
      where campaign_code='editor_launch_20260728'
    `;
  }

  process.stdout.write(`${JSON.stringify({
    cutoffKst: "2026-07-28T15:00:00+09:00",
    validUntilKst: "2026-10-26T15:00:00+09:00",
    eligibility,
    eligibilityByPlan,
    grants,
    announcements,
    invariants,
  }, null, 2)}\n`);
} finally {
  await sql.end({ timeout: 3 });
}
