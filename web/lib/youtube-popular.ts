import type { Sql } from "postgres";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { parseIsoDuration } from "@/lib/youtube";
import { isKoreanVideo } from "@/lib/youtube-language";

export const popularVideoTypes = ["trending", "views", "reusable"] as const;
export const popularReusablePeriods = ["today", "week", "all"] as const;
export const POPULAR_VIDEO_LONG_FORM_SECONDS = 4 * 60;
export const POPULAR_VIDEO_CATEGORY_PAGE_LIMIT = 15;
export const popularVideoCategories = [
  "all",
  "entertainment",
  "gaming",
  "sports",
  "music",
  "news",
  "science",
  "howto",
] as const;
export const popularVideoSourceCategoryValues = [
  "entertainment",
  "gaming",
  "sports",
  "music",
  "news",
  "science",
  "howto",
] as const;
export const popularVideoSourceCategories = [
  { value: "entertainment", videoCategoryId: "24" },
  { value: "gaming", videoCategoryId: "20" },
  { value: "sports", videoCategoryId: "17" },
  { value: "music", videoCategoryId: "10" },
  { value: "news", videoCategoryId: "25" },
  { value: "science", videoCategoryId: "28" },
  { value: "howto", videoCategoryId: "26" },
] as const;

export type PopularVideoType = (typeof popularVideoTypes)[number];
export type PopularReusablePeriod = (typeof popularReusablePeriods)[number];
export type PopularVideoCategory = (typeof popularVideoCategories)[number];
export type PopularVideoSourceCategory = (typeof popularVideoSourceCategoryValues)[number];
export type PopularVideoLicense = "creativeCommon" | "youtube";

export type PopularVideo = {
  videoId: string;
  category: PopularVideoSourceCategory;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  durationSeconds: number;
  viewCount: number;
  publishedAt: string;
  license: PopularVideoLicense;
};

export type PopularVideoResponse = {
  items: PopularVideo[];
  updatedAt: string;
  totalCount?: number;
  reusablePeriodCounts?: Record<PopularReusablePeriod, number>;
  nextCursor?: string;
};

export type PopularCollectionCategoryResult = {
  category: PopularVideoSourceCategory;
  pages: number;
  items: Array<PopularVideo & { categoryRank: number; pageNumber: number; isKorean: boolean }>;
};

export type PopularCollectionResult = {
  runId: string;
  snapshotDate: string;
  pages: number;
  items: number;
  categories: Array<{ category: PopularVideoSourceCategory; pages: number; items: number }>;
};

export class YoutubePopularApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoutubePopularApiError";
  }
}

export class PopularCollectionInProgressError extends Error {
  constructor() {
    super("인기 영상 수집이 이미 진행 중입니다.");
    this.name = "PopularCollectionInProgressError";
  }
}

export class PopularSnapshotUnavailableError extends Error {
  constructor() {
    super("아직 준비된 인기 영상 데이터가 없습니다. 잠시 후 다시 시도해 주세요.");
    this.name = "PopularSnapshotUnavailableError";
  }
}

const thumbnailSchema = z.object({ url: z.string().url() });
const videoResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(z.object({
    id: z.string(),
    snippet: z.object({
      title: z.string(),
      description: z.string().optional(),
      channelTitle: z.string(),
      publishedAt: z.string(),
      liveBroadcastContent: z.string().optional(),
      defaultLanguage: z.string().optional(),
      defaultAudioLanguage: z.string().optional(),
      thumbnails: z.record(z.string(), thumbnailSchema),
    }),
    contentDetails: z.object({ duration: z.string() }),
    statistics: z.object({ viewCount: z.string().optional() }).optional(),
    status: z.object({
      privacyStatus: z.string().optional(),
      license: z.string().optional(),
    }),
  })),
});

const cursorSchema = z.object({
  runId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
});

function selectThumbnail(thumbnails: Record<string, { url: string }>) {
  for (const name of ["maxres", "standard", "high", "medium", "default"]) {
    const thumbnail = thumbnails[name];
    if (thumbnail?.url) return thumbnail.url;
  }
  return Object.values(thumbnails)[0]?.url || "";
}

function normalizePage(
  response: z.infer<typeof videoResponseSchema>,
  category: PopularVideoSourceCategory,
  pageNumber: number,
  rankOffset: number,
) {
  const videos: PopularCollectionCategoryResult["items"] = [];
  response.items.forEach((item, index) => {
    const liveState = item.snippet.liveBroadcastContent;
    if ((liveState && liveState !== "none") || item.status.privacyStatus !== "public") return;
    const title = item.snippet.title.trim();
    const channelName = item.snippet.channelTitle.trim();
    const thumbnailUrl = selectThumbnail(item.snippet.thumbnails);
    const viewCount = Number.parseInt(item.statistics?.viewCount || "", 10);
    let durationSeconds = 0;
    try {
      durationSeconds = parseIsoDuration(item.contentDetails.duration);
    } catch {
      return;
    }
    if (
      !item.id
      || !title
      || !channelName
      || !thumbnailUrl
      || !Number.isFinite(viewCount)
      || viewCount < 0
      || durationSeconds <= 0
    ) return;
    videos.push({
      videoId: item.id,
      category,
      categoryRank: rankOffset + index + 1,
      pageNumber,
      title,
      channelName,
      thumbnailUrl,
      durationSeconds,
      viewCount,
      publishedAt: item.snippet.publishedAt,
      license: item.status.license === "creativeCommon" ? "creativeCommon" : "youtube",
      isKorean: isKoreanVideo(item.snippet),
    });
  });
  return videos;
}

async function requestPopularPage(
  category: (typeof popularVideoSourceCategories)[number],
  pageToken: string | undefined,
  fetchImpl: typeof fetch,
) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new YoutubePopularApiError("YOUTUBE_API_KEY가 설정되지 않아 인기 영상을 수집할 수 없습니다.");
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("key", apiKey);
  endpoint.searchParams.set("part", "snippet,contentDetails,statistics,status");
  endpoint.searchParams.set("chart", "mostPopular");
  endpoint.searchParams.set("regionCode", "KR");
  endpoint.searchParams.set("videoCategoryId", category.videoCategoryId);
  endpoint.searchParams.set("maxResults", "50");
  if (pageToken) endpoint.searchParams.set("pageToken", pageToken);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    console.error("YouTube popular collection connection failed", { category: category.value });
    throw new YoutubePopularApiError("YouTube 인기 영상 수집에 연결하지 못했습니다.");
  }
  if (!response.ok) {
    if (response.status === 404 && !pageToken) {
      console.warn("YouTube popular chart is unavailable", { category: category.value });
      return { items: [] };
    }
    console.error("YouTube popular collection request failed", {
      category: category.value,
      status: response.status,
    });
    throw new YoutubePopularApiError("YouTube 인기 영상 수집 요청에 실패했습니다.");
  }
  try {
    return videoResponseSchema.parse(await response.json());
  } catch {
    console.error("YouTube popular collection response was invalid", { category: category.value });
    throw new YoutubePopularApiError("YouTube 인기 영상 수집 응답을 확인하지 못했습니다.");
  }
}

export async function collectPopularCategory(
  category: (typeof popularVideoSourceCategories)[number],
  fetchImpl: typeof fetch = fetch,
): Promise<PopularCollectionCategoryResult> {
  const seenTokens = new Set<string>();
  const uniqueVideos = new Map<string, PopularCollectionCategoryResult["items"][number]>();
  let pageToken: string | undefined;
  let pageNumber = 0;
  let rankOffset = 0;

  do {
    pageNumber += 1;
    const response = await requestPopularPage(category, pageToken, fetchImpl);
    for (const video of normalizePage(response, category.value, pageNumber, rankOffset)) {
      if (!uniqueVideos.has(video.videoId)) uniqueVideos.set(video.videoId, video);
    }
    rankOffset += response.items.length;
    const nextPageToken = response.nextPageToken;
    if (nextPageToken && seenTokens.has(nextPageToken)) {
      throw new YoutubePopularApiError("YouTube 인기 영상 페이지 토큰이 반복되어 수집을 중단했습니다.");
    }
    if (nextPageToken) seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
  } while (pageToken && pageNumber < POPULAR_VIDEO_CATEGORY_PAGE_LIMIT);

  return { category: category.value, pages: pageNumber, items: Array.from(uniqueVideos.values()) };
}

async function collectAllCategories(fetchImpl: typeof fetch) {
  const results = new Array<PopularCollectionCategoryResult>(popularVideoSourceCategories.length);
  let nextCategoryIndex = 0;
  const workers = Array.from({ length: 3 }, async () => {
    while (nextCategoryIndex < popularVideoSourceCategories.length) {
      const index = nextCategoryIndex;
      nextCategoryIndex += 1;
      results[index] = await collectPopularCategory(popularVideoSourceCategories[index], fetchImpl);
    }
  });
  await Promise.all(workers);
  return results;
}

async function startCollectionRun(db: Sql, now: Date) {
  try {
    return await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.popular_video_runs
        set status='failed', completed_at=${now}, error_message='stale_collection_lease'
        where status='collecting' and started_at < ${new Date(now.getTime() - 30 * 60_000)}
      `;
      const rows = await tx`
        insert into shorts_mvp.popular_video_runs (snapshot_date, status, started_at, expires_at)
        values ((${now} at time zone 'Asia/Seoul')::date, 'collecting', ${now}, ${new Date(now.getTime() + 3 * 86_400_000)})
        returning id, snapshot_date::text as snapshot_date
      `;
      return { id: String(rows[0].id), snapshotDate: String(rows[0].snapshotDate) };
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new PopularCollectionInProgressError();
    }
    throw error;
  }
}

function safeCollectionError(error: unknown) {
  if (error instanceof YoutubePopularApiError || error instanceof PopularCollectionInProgressError) return error.message;
  return "인기 영상 수집 중 내부 오류가 발생했습니다.";
}

export async function collectPopularVideos(options: {
  db?: Sql;
  fetchImpl?: typeof fetch;
  now?: Date;
} = {}): Promise<PopularCollectionResult> {
  const db = options.db || getDb();
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || new Date();
  const run = await startCollectionRun(db, now);
  try {
    const categories = await collectAllCategories(fetchImpl);
    const allItems = categories.flatMap((result) => result.items);
    const pageCount = categories.reduce((total, result) => total + result.pages, 0);
    const categorySummary = Object.fromEntries(categories.map((result) => [result.category, {
      pages: result.pages,
      items: result.items.length,
    }]));

    await db.begin(async (tx) => {
      for (let offset = 0; offset < allItems.length; offset += 250) {
        const rows = allItems.slice(offset, offset + 250).map((video) => ({
          run_id: run.id,
          video_id: video.videoId,
          category: video.category,
          category_rank: video.categoryRank,
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
          insert into shorts_mvp.popular_video_items ${tx(
            rows,
            "run_id",
            "video_id",
            "category",
            "category_rank",
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
          on conflict (run_id, category, video_id) do update set
            category_rank=excluded.category_rank,
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
        update shorts_mvp.popular_video_runs set
          status='ready', completed_categories=${categories.length}, page_count=${pageCount},
          item_count=${allItems.length}, category_summary=${tx.json(categorySummary)},
          completed_at=${now}, error_message=null
        where id=${run.id}
      `;
    });

    return {
      runId: run.id,
      snapshotDate: run.snapshotDate,
      pages: pageCount,
      items: allItems.length,
      categories: categories.map((result) => ({
        category: result.category,
        pages: result.pages,
        items: result.items.length,
      })),
    };
  } catch (error) {
    await db`
      update shorts_mvp.popular_video_runs
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
    throw new Error("인기 영상 페이지 정보가 올바르지 않습니다.");
  }
}

async function resolveReadyRun(db: Sql, requestedRunId?: string, includeExpired = false) {
  const rows = requestedRunId
    ? await db`
      select id, completed_at from shorts_mvp.popular_video_runs
      where id=${requestedRunId} and status='ready'
        and (${includeExpired}=true or expires_at > now())
      limit 1
    `
    : await db`
      select id, completed_at from shorts_mvp.popular_video_runs
      where status='ready' and (${includeExpired}=true or expires_at > now())
      order by completed_at desc
      limit 1
    `;
  if (!rows[0]) throw new PopularSnapshotUnavailableError();
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

export async function getPopularVideos(
  type: PopularVideoType,
  category: PopularVideoCategory,
  reusableOnly: boolean,
  longFormOnly: boolean,
  koreanOnly: boolean,
  cursor?: string,
  limit = 48,
  db: Sql = getDb(),
): Promise<PopularVideoResponse> {
  const decodedCursor = decodeCursor(cursor);
  const run = await resolveReadyRun(db, decodedCursor?.runId, reusableOnly);
  const offset = decodedCursor?.offset || 0;
  const rows = reusableOnly
    ? await db`
      with historical_candidates as (
        select
          i.video_id, i.category, i.title, i.channel_name, i.thumbnail_url,
          i.duration_seconds, i.view_count, i.published_at, i.license,
          i.category_rank, r.completed_at as last_seen_at,
          row_number() over (
            partition by i.video_id
            order by r.completed_at desc, i.collected_at desc,
              i.category_rank asc, i.view_count desc, i.category asc
          ) as duplicate_rank
        from shorts_mvp.popular_video_items i
        join shorts_mvp.popular_video_runs r on r.id=i.run_id
        where r.status='ready' and r.completed_at <= ${run.completedAt}
          and i.license='creativeCommon'
          and (${category}='all' or i.category=${category})
          and (${longFormOnly}=false or i.duration_seconds >= ${POPULAR_VIDEO_LONG_FORM_SECONDS})
          and (${koreanOnly}=false or i.is_korean)
      )
      select video_id, category, title, channel_name, thumbnail_url, duration_seconds,
        view_count, published_at, license, category_rank, last_seen_at,
        count(*) over() as total_count
      from historical_candidates
      where duplicate_rank=1
      order by
        case when ${type}='views' then view_count end desc,
        case when ${type}='trending' then last_seen_at end desc,
        case when ${type}='trending' then category_rank end asc,
        published_at desc,
        view_count desc,
        video_id asc
      offset ${offset}
      limit ${limit + 1}
    `
    : await db`
      with candidates as (
        select
          video_id, category, title, channel_name, thumbnail_url, duration_seconds,
          view_count, published_at, license, category_rank,
          row_number() over (
            partition by video_id
            order by category_rank asc, view_count desc, category asc
          ) as duplicate_rank
        from shorts_mvp.popular_video_items
        where run_id=${run.id}
          and (${type}<>'views' or license <> 'creativeCommon')
          and (${category}='all' or category=${category})
          and (${longFormOnly}=false or duration_seconds >= ${POPULAR_VIDEO_LONG_FORM_SECONDS})
          and (${koreanOnly}=false or is_korean)
      )
      select video_id, category, title, channel_name, thumbnail_url, duration_seconds,
        view_count, published_at, license, category_rank, count(*) over() as total_count
      from candidates
      where duplicate_rank=1
      order by
        case when ${type}='trending' then category_rank end asc,
        case when ${type}='views' then view_count end desc,
        view_count desc,
        video_id asc
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

export async function getStoredPopularVideo(videoId: string, db: Sql = getDb()) {
  const rows = await db`
    select i.video_id, i.category, i.title, i.channel_name, i.thumbnail_url,
      i.duration_seconds, i.view_count, i.published_at, i.license
    from shorts_mvp.popular_video_items i
    join shorts_mvp.popular_video_runs r on r.id=i.run_id
    where i.video_id=${videoId} and r.status='ready'
      and (r.expires_at > now() or i.license='creativeCommon')
    order by r.completed_at desc
    limit 1
  `;
  return rows[0] ? rowToPopularVideo(rows[0] as Record<string, unknown>) : null;
}
