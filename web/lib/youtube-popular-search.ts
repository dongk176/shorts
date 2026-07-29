import type { Sql } from "postgres";
import { z } from "zod";
import { getDb } from "@/lib/db";
import {
  collectSearchVideoPages,
  YoutubeFreeApiError,
} from "@/lib/youtube-free";
import {
  POPULAR_REUSABLE_MIN_VIEW_COUNT,
  POPULAR_VIDEO_LONG_FORM_SECONDS,
  popularVideoSourceCategories,
  popularVideoSourceCategoryValues,
  type PopularDiscoveryPeriod,
  type PopularVideo,
  type PopularVideoCategory,
  type PopularReusablePeriod,
  type PopularVideoResponse,
} from "@/lib/youtube-popular";

export const POPULAR_SEARCH_PAGE_LIMIT = 40;
export const POPULAR_REUSABLE_SEARCH_PAGE_LIMIT = 10;
const POPULAR_SEARCH_QUERIES = [
  "엔터테인먼트",
  "예능",
  "게임",
  "e스포츠",
  "스포츠",
  "축구",
  "야구",
  "농구",
  "음악",
  "KPOP",
  "공연",
  "뮤직비디오",
  "교육",
  "강의",
  "공부",
  "지식",
  "뉴스",
  "정치",
  "경제",
  "사회",
  "과학",
  "기술",
  "IT",
  "인공지능",
  "여행",
  "국내여행",
  "해외여행",
  "브이로그",
  "요리",
  "레시피",
  "맛집",
  "먹방",
  "다큐멘터리",
  "인터뷰",
  "영화",
  "드라마",
  "리뷰",
  "자동차",
  "건강",
  "운동",
] as const;

export type PopularSearchCollectionResult = {
  runId: string;
  snapshotDate: string;
  pages: number;
  reusablePages: number;
  items: number;
  hasMoreOnYoutube: boolean;
};

export type ReusablePopularSearchCollectionResult = {
  runId: string;
  snapshotDate: string;
  pages: number;
  items: number;
  totalItems: number;
  hasMoreOnYoutube: boolean;
};

export class PopularSearchCollectionInProgressError extends Error {
  constructor() {
    super("조회수 상위 영상 수집이 이미 진행 중입니다.");
    this.name = "PopularSearchCollectionInProgressError";
  }
}

export class PopularSearchSnapshotUnavailableError extends Error {
  constructor() {
    super("아직 준비된 조회수 상위 영상 데이터가 없습니다. 잠시 후 다시 시도해 주세요.");
    this.name = "PopularSearchSnapshotUnavailableError";
  }
}

const cursorSchema = z.object({
  runId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
});

async function startCollectionRun(db: Sql, now: Date) {
  try {
    return await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.popular_search_runs
        set status='failed', completed_at=${now}, error_message='stale_collection_lease'
        where status='collecting' and started_at < ${new Date(now.getTime() - 30 * 60_000)}
      `;
      const rows = await tx`
        insert into shorts_mvp.popular_search_runs (snapshot_date, status, started_at)
        values ((${now} at time zone 'Asia/Seoul')::date, 'collecting', ${now})
        returning id, snapshot_date::text as snapshot_date
      `;
      return { id: String(rows[0].id), snapshotDate: String(rows[0].snapshotDate) };
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new PopularSearchCollectionInProgressError();
    }
    throw error;
  }
}

function safeCollectionError(error: unknown) {
  if (error instanceof YoutubeFreeApiError || error instanceof PopularSearchCollectionInProgressError) {
    return error.message;
  }
  return "조회수 상위 영상 수집 중 내부 오류가 발생했습니다.";
}

async function collectReusableSearchPages(options: {
  now: Date;
  fetchImpl?: typeof fetch;
  maxPages?: number;
  requestIntervalMs?: number;
}) {
  const kstDay = Math.floor((options.now.getTime() + 9 * 60 * 60_000) / 86_400_000);
  const categoryOffset = kstDay % popularVideoSourceCategories.length;
  const rotatedCategories = [
    ...popularVideoSourceCategories.slice(categoryOffset),
    ...popularVideoSourceCategories.slice(0, categoryOffset),
  ];
  const reusableSources = rotatedCategories.map((category) => ({
    videoCategoryId: category.videoCategoryId,
    publishedAfter: null,
  }));
  const collection = await collectSearchVideoPages({
    maxPages: Math.min(
      POPULAR_REUSABLE_SEARCH_PAGE_LIMIT,
      Math.max(1, options.maxPages || POPULAR_REUSABLE_SEARCH_PAGE_LIMIT),
    ),
    now: options.now,
    fetchImpl: options.fetchImpl,
    requestIntervalMs: options.requestIntervalMs,
    sources: reusableSources,
    videoLicense: "creativeCommon",
  });
  return {
    ...collection,
    items: collection.items.filter((video) => video.license === "creativeCommon"),
  };
}

export async function collectPopularSearchVideos(options: {
  db?: Sql;
  fetchImpl?: typeof fetch;
  now?: Date;
  maxPages?: number;
  reusableMaxPages?: number;
  requestIntervalMs?: number;
} = {}): Promise<PopularSearchCollectionResult> {
  const db = options.db || getDb();
  const now = options.now || new Date();
  const run = await startCollectionRun(db, now);
  try {
    const collection = await collectSearchVideoPages({
      maxPages: Math.min(POPULAR_SEARCH_PAGE_LIMIT, Math.max(1, options.maxPages || POPULAR_SEARCH_PAGE_LIMIT)),
      now,
      fetchImpl: options.fetchImpl,
      requestIntervalMs: options.requestIntervalMs,
      queries: POPULAR_SEARCH_QUERIES,
    });
    const reusableCollection = await collectReusableSearchPages({
      now,
      fetchImpl: options.fetchImpl,
      maxPages: options.reusableMaxPages,
      requestIntervalMs: options.requestIntervalMs,
    });
    const mergedItems = new Map(collection.items.map((video) => [video.videoId, video]));
    for (const video of reusableCollection.items) {
      mergedItems.set(video.videoId, video);
    }
    const items = Array.from(mergedItems.values());
    const pages = collection.pages + reusableCollection.pages;
    await db.begin(async (tx) => {
      for (let offset = 0; offset < items.length; offset += 250) {
        const rows = items.slice(offset, offset + 250).map((video) => ({
          run_id: run.id,
          video_id: video.videoId,
          category: video.category,
          search_rank: video.searchRank,
          page_number: video.pageNumber,
          title: video.title,
          channel_name: video.channelName,
          thumbnail_url: video.thumbnailUrl,
          duration_seconds: video.durationSeconds,
          view_count: video.viewCount,
          published_at: video.publishedAt,
          license: video.license,
          is_korean: video.isKorean,
          collected_at: now,
        }));
        await tx`
          insert into shorts_mvp.popular_search_items ${tx(
            rows,
            "run_id",
            "video_id",
            "category",
            "search_rank",
            "page_number",
            "title",
            "channel_name",
            "thumbnail_url",
            "duration_seconds",
            "view_count",
            "published_at",
            "license",
            "is_korean",
            "collected_at",
          )}
          on conflict (run_id, video_id) do nothing
        `;
      }
      await tx`
        update shorts_mvp.popular_search_runs set
          status='ready', page_count=${pages}, item_count=${items.length},
          completed_at=${now}, error_message=null
        where id=${run.id}
      `;
    });
    return {
      runId: run.id,
      snapshotDate: run.snapshotDate,
      pages,
      reusablePages: reusableCollection.pages,
      items: items.length,
      hasMoreOnYoutube: Boolean(collection.nextPageToken || reusableCollection.nextPageToken),
    };
  } catch (error) {
    await db`
      update shorts_mvp.popular_search_runs
      set status='failed', completed_at=${new Date()}, error_message=${safeCollectionError(error)}
      where id=${run.id}
    `.catch(() => undefined);
    throw error;
  }
}

export async function collectReusablePopularSearchVideos(options: {
  db?: Sql;
  fetchImpl?: typeof fetch;
  now?: Date;
  maxPages?: number;
  requestIntervalMs?: number;
} = {}): Promise<ReusablePopularSearchCollectionResult> {
  const db = options.db || getDb();
  const now = options.now || new Date();
  const run = await startCollectionRun(db, now);
  try {
    const collection = await collectReusableSearchPages({
      now,
      fetchImpl: options.fetchImpl,
      maxPages: options.maxPages,
      requestIntervalMs: options.requestIntervalMs,
    });
    await db.begin(async (tx) => {
      for (let offset = 0; offset < collection.items.length; offset += 250) {
        const rows = collection.items.slice(offset, offset + 250).map((video) => ({
          run_id: run.id,
          video_id: video.videoId,
          category: video.category,
          search_rank: video.searchRank,
          page_number: video.pageNumber,
          title: video.title,
          channel_name: video.channelName,
          thumbnail_url: video.thumbnailUrl,
          duration_seconds: video.durationSeconds,
          view_count: video.viewCount,
          published_at: video.publishedAt,
          license: video.license,
          is_korean: video.isKorean,
          collected_at: now,
        }));
        await tx`
          insert into shorts_mvp.popular_search_items ${tx(
            rows,
            "run_id",
            "video_id",
            "category",
            "search_rank",
            "page_number",
            "title",
            "channel_name",
            "thumbnail_url",
            "duration_seconds",
            "view_count",
            "published_at",
            "license",
            "is_korean",
            "collected_at",
          )}
          on conflict (run_id, video_id) do update set
            category=excluded.category,
            search_rank=excluded.search_rank,
            page_number=excluded.page_number,
            title=excluded.title,
            channel_name=excluded.channel_name,
            thumbnail_url=excluded.thumbnail_url,
            duration_seconds=excluded.duration_seconds,
            view_count=excluded.view_count,
            published_at=excluded.published_at,
            license=excluded.license,
            is_korean=excluded.is_korean,
            collected_at=excluded.collected_at
        `;
      }
      await tx`
        update shorts_mvp.popular_search_runs set
          status='ready', page_count=${collection.pages},
          item_count=${collection.items.length}, completed_at=${now}, error_message=null
        where id=${run.id}
      `;
    });
    return {
      runId: run.id,
      snapshotDate: run.snapshotDate,
      pages: collection.pages,
      items: collection.items.length,
      totalItems: collection.items.length,
      hasMoreOnYoutube: Boolean(collection.nextPageToken),
    };
  } catch (error) {
    await db`
      update shorts_mvp.popular_search_runs
      set status='failed', completed_at=${new Date()}, error_message=${safeCollectionError(error)}
      where id=${run.id}
    `.catch(() => undefined);
    throw error;
  }
}

function encodeCursor(runId: string, offset: number) {
  return Buffer.from(JSON.stringify({ runId, offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new Error("조회수 상위 영상 페이지 정보가 올바르지 않습니다.");
  }
}

async function resolveReadyRun(
  db: Sql,
  requestedRunId?: string,
  standardVideosOnly = false,
) {
  const rows = requestedRunId
    ? await db`
      select r.id, r.completed_at
      from shorts_mvp.popular_search_runs r
      where r.id=${requestedRunId} and r.status='ready'
        and (${standardVideosOnly}=false or exists (
          select 1
          from shorts_mvp.popular_search_items i
          where i.run_id=r.id and i.license <> 'creativeCommon'
        ))
      limit 1
    `
    : await db`
      select r.id, r.completed_at
      from shorts_mvp.popular_search_runs r
      where r.status='ready'
        and (${standardVideosOnly}=false or exists (
          select 1
          from shorts_mvp.popular_search_items i
          where i.run_id=r.id and i.license <> 'creativeCommon'
        ))
      order by r.completed_at desc
      limit 1
    `;
  if (!rows[0]) throw new PopularSearchSnapshotUnavailableError();
  return { id: String(rows[0].id), completedAt: new Date(rows[0].completedAt).toISOString() };
}

function rowToPopularVideo(row: Record<string, unknown>): PopularVideo {
  return {
    videoId: String(row.videoId),
    category: z.enum(popularVideoSourceCategoryValues).parse(row.category),
    title: String(row.title),
    channelName: String(row.channelName),
    thumbnailUrl: String(row.thumbnailUrl),
    durationSeconds: Number(row.durationSeconds),
    viewCount: Number(row.viewCount),
    publishedAt: new Date(String(row.publishedAt)).toISOString(),
    license: row.license === "creativeCommon" ? "creativeCommon" : "youtube",
  };
}

export async function getPopularSearchVideos(
  category: PopularVideoCategory,
  reusableOnly: boolean,
  longFormOnly: boolean,
  koreanOnly: boolean,
  cursor?: string,
  limit = 48,
  discoveryPeriod: PopularDiscoveryPeriod = "all",
  db: Sql = getDb(),
): Promise<PopularVideoResponse> {
  const decodedCursor = decodeCursor(cursor);
  const run = await resolveReadyRun(db, decodedCursor?.runId, !reusableOnly);
  const offset = decodedCursor?.offset || 0;
  if (discoveryPeriod !== "all" || !cursor) {
    const rows = await db`
      with run_window as (
        select
          current_run.completed_at as current_completed_at,
          coalesce((
            select max(previous_run.completed_at)
            from shorts_mvp.popular_search_runs previous_run
            where previous_run.status='ready'
              and previous_run.completed_at < current_run.completed_at
          ), '-infinity'::timestamptz) as previous_completed_at
        from shorts_mvp.popular_search_runs current_run
        where current_run.id=${run.id}
      ),
      historical_candidates as (
        select
          i.video_id, i.category, i.title, i.channel_name, i.thumbnail_url,
          i.duration_seconds, i.view_count, i.published_at, i.license,
          r.completed_at as last_seen_at,
          min(r.completed_at) over (partition by i.video_id) as first_seen_at,
          row_number() over (
            partition by i.video_id
            order by r.completed_at desc, i.collected_at desc,
              i.search_rank asc, i.view_count desc
          ) as duplicate_rank
        from shorts_mvp.popular_search_items i
        join shorts_mvp.popular_search_runs r on r.id=i.run_id
        where r.status='ready'
          and r.completed_at <= (select current_completed_at from run_window)
          and (
            (${reusableOnly}=true and i.license='creativeCommon')
            or (${reusableOnly}=false and i.license <> 'creativeCommon')
          )
          and (${category}='all' or i.category=${category})
          and (${longFormOnly}=false or i.duration_seconds >= ${POPULAR_VIDEO_LONG_FORM_SECONDS})
          and (${koreanOnly}=false or i.is_korean)
      ),
      scoped as (
        select *
        from historical_candidates
        where duplicate_rank=1
          and (
            ${reusableOnly}=true
            or exists (
              select 1
              from shorts_mvp.popular_search_items current_item
              where current_item.run_id=${run.id}
                and current_item.video_id=historical_candidates.video_id
                and current_item.license <> 'creativeCommon'
                and (${category}='all' or current_item.category=${category})
                and (${longFormOnly}=false or current_item.duration_seconds >= ${POPULAR_VIDEO_LONG_FORM_SECONDS})
                and (${koreanOnly}=false or current_item.is_korean)
            )
          )
      ),
      period_counts as (
        select
          count(*) filter (
            where first_seen_at > run_window.previous_completed_at
          ) as today_count,
          count(*) filter (
            where first_seen_at >= (
              date_trunc('day', run_window.current_completed_at at time zone 'Asia/Seoul')
              at time zone 'Asia/Seoul'
            ) - interval '6 days'
          ) as week_count,
          count(*) as all_count
        from scoped
        cross join run_window
      ),
      paged as (
        select
          video_id, category, title, channel_name, thumbnail_url, duration_seconds,
          view_count, published_at, license, last_seen_at, first_seen_at,
          row_number() over (
            order by
              case when ${discoveryPeriod}<>'all' then first_seen_at end desc,
              view_count desc, last_seen_at desc,
              published_at desc, video_id asc
          ) as page_rank
        from scoped
        cross join run_window
        where (
          ${discoveryPeriod}='all'
          or (${discoveryPeriod}='today' and first_seen_at > run_window.previous_completed_at)
          or (
            ${discoveryPeriod}='week'
            and first_seen_at >= (
              date_trunc('day', run_window.current_completed_at at time zone 'Asia/Seoul')
              at time zone 'Asia/Seoul'
            ) - interval '6 days'
          )
        )
        order by
          case when ${discoveryPeriod}<>'all' then first_seen_at end desc,
          view_count desc, last_seen_at desc,
          published_at desc, video_id asc
        offset ${offset}
        limit ${limit + 1}
      )
      select
        paged.video_id, paged.category, paged.title, paged.channel_name,
        paged.thumbnail_url, paged.duration_seconds, paged.view_count,
        paged.published_at, paged.license, paged.last_seen_at, paged.first_seen_at,
        period_counts.today_count, period_counts.week_count, period_counts.all_count
      from period_counts
      left join paged on true
      order by paged.page_rank asc nulls last
    `;
    const itemRows = rows.filter((row) => row.videoId !== null && row.videoId !== undefined);
    const periodCounts = {
      today: Number(rows[0]?.todayCount || 0),
      week: Number(rows[0]?.weekCount || 0),
      all: Number(rows[0]?.allCount || 0),
    };
    const hasNext = itemRows.length > limit;
    return {
      items: itemRows.slice(0, limit).map((row) => rowToPopularVideo(row as Record<string, unknown>)),
      updatedAt: run.completedAt,
      totalCount: periodCounts[discoveryPeriod],
      periodCounts,
      ...(hasNext ? { nextCursor: encodeCursor(run.id, offset + limit) } : {}),
    };
  }

  const rows = reusableOnly
    ? await db`
      with historical_candidates as (
        select
          i.video_id, i.category, i.title, i.channel_name, i.thumbnail_url,
          i.duration_seconds, i.view_count, i.published_at, i.license,
          r.completed_at as last_seen_at,
          row_number() over (
            partition by i.video_id
            order by r.completed_at desc, i.collected_at desc,
              i.search_rank asc, i.view_count desc
          ) as duplicate_rank
        from shorts_mvp.popular_search_items i
        join shorts_mvp.popular_search_runs r on r.id=i.run_id
        where r.status='ready' and r.completed_at <= (
          select completed_at
          from shorts_mvp.popular_search_runs
          where id=${run.id}
        )
          and i.license='creativeCommon'
          and (${category}='all' or i.category=${category})
          and (${longFormOnly}=false or i.duration_seconds >= ${POPULAR_VIDEO_LONG_FORM_SECONDS})
          and (${koreanOnly}=false or i.is_korean)
      )
      select video_id, category, title, channel_name, thumbnail_url, duration_seconds,
        view_count, published_at, license, last_seen_at, count(*) over() as total_count
      from historical_candidates
      where duplicate_rank=1
      order by view_count desc, last_seen_at desc, published_at desc, video_id asc
      offset ${offset}
      limit ${limit + 1}
    `
    : await db`
      select video_id, category, title, channel_name, thumbnail_url, duration_seconds,
        view_count, published_at, license, count(*) over() as total_count
      from shorts_mvp.popular_search_items
      where run_id=${run.id}
        and license <> 'creativeCommon'
        and (${category}='all' or category=${category})
        and (${longFormOnly}=false or duration_seconds >= ${POPULAR_VIDEO_LONG_FORM_SECONDS})
        and (${koreanOnly}=false or is_korean)
      order by view_count desc, published_at desc, video_id asc
      offset ${offset}
      limit ${limit + 1}
    `;
  const hasNext = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((row) => rowToPopularVideo(row as Record<string, unknown>)),
    updatedAt: run.completedAt,
    totalCount: rows[0] ? Number(rows[0].totalCount) : 0,
    ...(hasNext ? { nextCursor: encodeCursor(run.id, offset + limit) } : {}),
  };
}

export async function getReusablePopularVideos(
  category: PopularVideoCategory,
  longFormOnly: boolean,
  koreanOnly: boolean,
  cursor?: string,
  limit = 48,
  discoveryPeriod: PopularReusablePeriod = "all",
  db: Sql = getDb(),
): Promise<PopularVideoResponse> {
  const decodedCursor = decodeCursor(cursor);
  const run = await resolveReadyRun(db, decodedCursor?.runId);
  const offset = decodedCursor?.offset || 0;
  const rows = await db`
    with run_window as (
      select
        current_run.completed_at as current_completed_at,
        coalesce((
          select max(previous_run.completed_at)
          from shorts_mvp.popular_search_runs previous_run
          where previous_run.status='ready'
            and previous_run.completed_at < current_run.completed_at
        ), '-infinity'::timestamptz) as previous_completed_at
      from shorts_mvp.popular_search_runs current_run
      where current_run.id=${run.id}
    ),
    all_reusable_candidates as (
      select
        i.video_id, i.category, i.title, i.channel_name, i.thumbnail_url,
        i.duration_seconds, i.view_count, i.published_at, i.license, i.is_korean,
        i.collected_at, r.completed_at as last_seen_at, 0 as source_priority
      from shorts_mvp.popular_search_items i
      join shorts_mvp.popular_search_runs r on r.id=i.run_id
      where r.status='ready'
        and r.completed_at <= (select current_completed_at from run_window)
        and i.license='creativeCommon'
      union all
      select
        i.video_id, i.category, i.title, i.channel_name, i.thumbnail_url,
        i.duration_seconds, i.view_count, i.published_at, i.license, i.is_korean,
        i.collected_at, r.completed_at as last_seen_at, 1 as source_priority
      from shorts_mvp.popular_video_items i
      join shorts_mvp.popular_video_runs r on r.id=i.run_id
      where r.status='ready'
        and r.completed_at <= (select current_completed_at from run_window)
        and i.license='creativeCommon'
    ),
    ranked as (
      select *,
        min(last_seen_at) over (partition by video_id) as first_seen_at,
        row_number() over (
          partition by video_id
          order by last_seen_at desc, collected_at desc, view_count desc, source_priority asc
        ) as duplicate_rank
      from all_reusable_candidates
    ),
    scoped as (
      select *
      from ranked
      where duplicate_rank=1
        and view_count > ${POPULAR_REUSABLE_MIN_VIEW_COUNT}
        and (${category}='all' or category=${category})
        and (${longFormOnly}=false or duration_seconds >= ${POPULAR_VIDEO_LONG_FORM_SECONDS})
        and (${koreanOnly}=false or is_korean)
    ),
    period_counts as (
      select
        count(*) filter (
          where first_seen_at > run_window.previous_completed_at
        ) as today_count,
        count(*) filter (
          where first_seen_at >= (
            date_trunc('day', run_window.current_completed_at at time zone 'Asia/Seoul')
            at time zone 'Asia/Seoul'
          ) - interval '6 days'
        ) as week_count,
        count(*) as all_count
      from scoped
      cross join run_window
    ),
    paged as (
      select
        video_id, category, title, channel_name, thumbnail_url, duration_seconds,
        view_count, published_at, license, last_seen_at, first_seen_at,
        row_number() over (
          order by
            case when ${discoveryPeriod}<>'all' then first_seen_at end desc,
            view_count desc, last_seen_at desc, published_at desc, video_id asc
        ) as page_rank
      from scoped
      cross join run_window
      where (
          ${discoveryPeriod}='all'
          or (
            ${discoveryPeriod}='today'
            and first_seen_at > run_window.previous_completed_at
          )
          or (
            ${discoveryPeriod}='week'
            and first_seen_at >= (
              date_trunc('day', run_window.current_completed_at at time zone 'Asia/Seoul')
              at time zone 'Asia/Seoul'
            ) - interval '6 days'
          )
        )
      order by
        case when ${discoveryPeriod}<>'all' then first_seen_at end desc,
        view_count desc, last_seen_at desc, published_at desc, video_id asc
      offset ${offset}
      limit ${limit + 1}
    )
    select
      paged.video_id, paged.category, paged.title, paged.channel_name,
      paged.thumbnail_url, paged.duration_seconds, paged.view_count,
      paged.published_at, paged.license, paged.last_seen_at, paged.first_seen_at,
      period_counts.today_count, period_counts.week_count, period_counts.all_count
    from period_counts
    left join paged on true
    order by paged.page_rank asc nulls last
  `;
  const itemRows = rows.filter((row) => row.videoId !== null && row.videoId !== undefined);
  const counts = {
    today: Number(rows[0]?.todayCount || 0),
    week: Number(rows[0]?.weekCount || 0),
    all: Number(rows[0]?.allCount || 0),
  };
  const hasNext = itemRows.length > limit;
  return {
    items: itemRows.slice(0, limit).map((row) => rowToPopularVideo(row as Record<string, unknown>)),
    updatedAt: run.completedAt,
    totalCount: counts[discoveryPeriod],
    periodCounts: counts,
    reusablePeriodCounts: counts,
    ...(hasNext ? { nextCursor: encodeCursor(run.id, offset + limit) } : {}),
  };
}

export async function getStoredPopularSearchVideo(videoId: string, db: Sql = getDb()) {
  const rows = await db`
    select i.video_id, i.category, i.title, i.channel_name, i.thumbnail_url,
      i.duration_seconds, i.view_count, i.published_at, i.license
    from shorts_mvp.popular_search_items i
    join shorts_mvp.popular_search_runs r on r.id=i.run_id
    where i.video_id=${videoId} and r.status='ready'
    order by r.completed_at desc
    limit 1
  `;
  return rows[0] ? rowToPopularVideo(rows[0] as Record<string, unknown>) : null;
}
