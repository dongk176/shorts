import { z } from "zod";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { getJapanSettings, updateJapanSettings } from "@/lib/youtube-japan-settings";
import { getCatalogBackfillReadiness } from "@/lib/youtube-catalog-backfill";
import { NextResponse } from "next/server";
import { withReadRequest } from "@/lib/read-request";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import {
  discoveryEnabled,
  catalogReadsEnabled,
  expandedDiscoveryEnabled,
  japaneseQuotaVerified,
} from "@/lib/youtube-quota";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return await withReadRequest("admin-youtube-discovery", async (stage) => {
      await stage("authorization", () => requireAdminUser());
      if (!discoveryEnabled()) return NextResponse.json({ enabled: false });
      const db = getDb();
      const project = process.env.YOUTUBE_QUOTA_PROJECT_ID || "";
      const [usage, runs, pending, expanded, backfill, accounting, japanVerification, japanSettings] = await stage("status", () => Promise.all([
        db`select bucket,purpose,region_code,sum(units)::int as units,sum(attempts)::int as attempts,
          sum(opening_units)::int as opening_units,sum(metered_units)::int as metered_units from (
            select bucket,purpose,region_code,units,1 as attempts,0 as opening_units,units as metered_units
            from shorts_mvp.youtube_quota_attempts where project_id=${project}
              and quota_day=(clock_timestamp() at time zone 'America/Los_Angeles')::date
            union all
            select bucket,purpose,'KR' as region_code,units,0 as attempts,units as opening_units,0 as metered_units
            from shorts_mvp.youtube_quota_opening_balances where project_id=${project}
              and quota_day=(clock_timestamp() at time zone 'America/Los_Angeles')::date
          ) counted group by region_code,bucket,purpose order by region_code,bucket,purpose`,
        db`select lane,region_code,scheduled_at,started_at,finished_at,status,page_count,item_count,failed_pages from shorts_mvp.youtube_collection_runs order by started_at desc limit 30`,
        db`select count(*)::int as catalog_count,
          count(*) filter(where video_id is not null and refresh_after<=clock_timestamp())::int as pending_count,
          count(*) filter(where video_id is not null and verified_at<clock_timestamp()-interval '25 days')::int as urgent_count,
          count(*) filter(where metadata is null)::int as unavailable_count from shorts_mvp.youtube_catalog`,
        expandedDiscoveryEnabled(db),
        getCatalogBackfillReadiness(db),
        db`select accounting_ready_from,
          coalesce(accounting_ready_from<=(clock_timestamp() at time zone 'America/Los_Angeles')::date,false) as ready
          from shorts_mvp.youtube_quota_verifications where project_id=${project}`,
        japaneseQuotaVerified(db),
        getJapanSettings(db),
      ]));
      const sum = (bucket: string, background = false, region = "KR") =>
        usage
          .filter(
            (row) =>
              row.bucket === bucket &&
              row.regionCode === region &&
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
          japan: {
            ...japanSettings,
            collection: japanSettings.collection,
            reads: japanSettings.reads,
            verified: Boolean(japanVerification),
            searchEnabled: Boolean(japanVerification && japanVerification.searchEnabled),
            remaining: {
              search: japanVerification && japanVerification.searchEnabled ? Math.max(0, 10 - sum("search", false, "JP")) : 0,
              general: japanVerification ? Math.max(0, 17 - sum("general", false, "JP")) : 0,
            },
          },
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
    }, request.signal);
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

const japanSettingsInput = z.object({
  collection: z.boolean(), reads: z.boolean(),
}).strict();
export async function POST(request: Request) {
  try {
    assertSameOriginJsonRequest(request);
    const admin = await requireAdminUser();
    const text = await request.text();
    if (text.length > 1000) throw new HttpError(413, "설정 요청이 너무 큽니다.");
    const parsed = japanSettingsInput.safeParse(JSON.parse(text));
    if (!parsed.success) throw new HttpError(400, "올바른 수집 설정을 입력해 주세요.");
    await updateJapanSettings(getDb(), admin.id, parsed.data);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ detail: "올바른 JSON 요청이 필요합니다." }, { status: 400 });
    return apiError(error);
  }
}
