import { getCatalogBackfillReadiness } from "@/lib/youtube-catalog-backfill";
import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import {
  discoveryEnabled,
  catalogReadsEnabled,
  expandedDiscoveryEnabled,
} from "@/lib/youtube-quota";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requireAdminUser();
    if (!discoveryEnabled()) return NextResponse.json({ enabled: false });
    const db = getDb();
    const project = process.env.YOUTUBE_QUOTA_PROJECT_ID || "";
    const [usage, runs, pending, expanded, backfill, accounting] = await Promise.all([
      db`select bucket,purpose,sum(units)::int as units,sum(attempts)::int as attempts,
        sum(opening_units)::int as opening_units,sum(metered_units)::int as metered_units from (
          select bucket,purpose,units,1 as attempts,0 as opening_units,units as metered_units
          from shorts_mvp.youtube_quota_attempts where project_id=${project}
            and quota_day=(clock_timestamp() at time zone 'America/Los_Angeles')::date
          union all
          select bucket,purpose,units,0 as attempts,units as opening_units,0 as metered_units
          from shorts_mvp.youtube_quota_opening_balances where project_id=${project}
            and quota_day=(clock_timestamp() at time zone 'America/Los_Angeles')::date
        ) counted group by bucket,purpose order by bucket,purpose`,
      db`select lane,scheduled_at,started_at,finished_at,status,page_count,item_count,failed_pages from shorts_mvp.youtube_collection_runs order by started_at desc limit 30`,
      db`select count(*)::int as catalog_count,
        count(*) filter(where video_id is not null and refresh_after<=clock_timestamp())::int as pending_count,
        count(*) filter(where video_id is not null and verified_at<clock_timestamp()-interval '25 days')::int as urgent_count,
        count(*) filter(where metadata is null)::int as unavailable_count from shorts_mvp.youtube_catalog`,
      expandedDiscoveryEnabled(db),
      getCatalogBackfillReadiness(db),
      db`select accounting_ready_from,
        coalesce(accounting_ready_from<=(clock_timestamp() at time zone 'America/Los_Angeles')::date,false) as ready
        from shorts_mvp.youtube_quota_verifications where project_id=${project}`,
    ]);
    const sum = (bucket: string, background = false) =>
      usage
        .filter(
          (row) =>
            row.bucket === bucket &&
            (!background || row.purpose !== "analysis"),
        )
        .reduce((total, row) => total + Number(row.units), 0);
    return NextResponse.json(
      {
        enabled: true,
        backfill,
        reads: catalogReadsEnabled(),
        legacyCleanupEnabled:
          process.env.YOUTUBE_LEGACY_SNAPSHOT_CLEANUP_ENABLED === "true",
        expanded,
        project,
        usage,
        accounting: accounting[0] || { ready: false, accountingReadyFrom: null },
        runs,
        pending: pending[0],
        remaining: {
          search: Math.max(0, 90 - sum("search")),
          general: Math.max(0, 9000 - sum("general")),
          background: Math.max(0, 3000 - sum("general", true)),
        },
        quotaTimezone: "America/Los_Angeles",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
