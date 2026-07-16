import type { Sql } from "postgres";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { parseIsoDuration } from "@/lib/youtube";
import { isKoreanVideo } from "@/lib/youtube-language";
import type { PopularVideo, PopularVideoResponse, PopularVideoSourceCategory } from "@/lib/youtube-popular";

const FREE_SEARCH_PAGE_SIZE = 50;
const FREE_SEARCH_WINDOW_DAYS = 7;
const FREE_SEARCH_REQUEST_INTERVAL_MS = 1_000;
const FREE_SEARCH_QUERIES = [
  "엔터테인먼트",
  "예능",
  "게임",
  "e스포츠",
  "스포츠",
  "축구",
  "야구",
  "음악",
  "KPOP",
  "공연",
  "교육",
  "강의",
  "지식",
  "뉴스 정치",
  "경제",
  "사회",
  "과학 기술",
  "IT",
  "인공지능",
  "여행",
  "브이로그",
  "요리 노하우",
  "레시피",
  "맛집",
  "다큐멘터리",
  "인터뷰",
  "영화",
  "드라마",
  "건강",
  "운동",
] as const;

const searchResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(z.object({
    id: z.object({ videoId: z.string() }),
  })).default([]),
});

const thumbnailSchema = z.object({ url: z.string().url() });
const detailsResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    snippet: z.object({
      title: z.string(),
      description: z.string().optional(),
      channelTitle: z.string(),
      categoryId: z.string().optional(),
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
      embeddable: z.boolean().optional(),
    }),
    liveStreamingDetails: z.unknown().optional(),
  })).default([]),
});

const cursorSchema = z.object({
  runId: z.string().uuid(),
  offset: z.number().int().nonnegative(),
});

export type StoredSearchVideo = PopularVideo & { searchRank: number; pageNumber: number; isKorean: boolean };

export type FreeCollectionResult = {
  runId: string;
  snapshotDate: string;
  pages: number;
  items: number;
  hasMoreOnYoutube: boolean;
};

export class YoutubeFreeApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YoutubeFreeApiError";
  }
}

export class FreeCollectionInProgressError extends Error {
  constructor() {
    super("무료 소재 수집이 이미 진행 중입니다.");
    this.name = "FreeCollectionInProgressError";
  }
}

export class FreeSnapshotUnavailableError extends Error {
  constructor() {
    super("아직 준비된 오늘의 무료 소재가 없습니다. 잠시 후 다시 시도해 주세요.");
    this.name = "FreeSnapshotUnavailableError";
  }
}

function selectThumbnail(thumbnails: Record<string, { url: string }>) {
  for (const name of ["maxres", "standard", "high", "medium", "default"]) {
    const thumbnail = thumbnails[name];
    if (thumbnail?.url) return thumbnail.url;
  }
  return Object.values(thumbnails)[0]?.url || "";
}

function categoryFromYoutube(categoryId: string | undefined): PopularVideoSourceCategory {
  const categories: Record<string, PopularVideoSourceCategory> = {
    "10": "music",
    "17": "sports",
    "20": "gaming",
    "24": "entertainment",
    "25": "news",
    "26": "howto",
    "28": "science",
  };
  return categories[categoryId || ""] || "entertainment";
}

function apiKey() {
  const value = process.env.YOUTUBE_API_KEY;
  if (!value) throw new YoutubeFreeApiError("YOUTUBE_API_KEY가 설정되지 않아 무료 소재를 수집할 수 없습니다.");
  return value;
}

async function requestFreeSearchPage(options: {
  query: string;
  pageToken?: string;
  now: Date;
  fetchImpl: typeof fetch;
}) {
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.searchParams.set("key", apiKey());
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("type", "video");
  endpoint.searchParams.set("q", options.query);
  endpoint.searchParams.set("order", "viewCount");
  endpoint.searchParams.set("publishedAfter", new Date(options.now.getTime() - FREE_SEARCH_WINDOW_DAYS * 86_400_000).toISOString());
  endpoint.searchParams.set("regionCode", "KR");
  endpoint.searchParams.set("relevanceLanguage", "ko");
  endpoint.searchParams.set("videoDuration", "any");
  endpoint.searchParams.set("videoEmbeddable", "true");
  endpoint.searchParams.set("safeSearch", "moderate");
  endpoint.searchParams.set("maxResults", String(FREE_SEARCH_PAGE_SIZE));
  if (options.pageToken) endpoint.searchParams.set("pageToken", options.pageToken);

  let response: Response;
  try {
    response = await options.fetchImpl(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    console.error("YouTube free search connection failed");
    throw new YoutubeFreeApiError("YouTube 무료 소재 검색에 연결하지 못했습니다.");
  }
  if (!response.ok) {
    console.error("YouTube free search request failed", { status: response.status });
    throw new YoutubeFreeApiError("YouTube 무료 소재 검색 요청에 실패했습니다.");
  }
  try {
    return searchResponseSchema.parse(await response.json());
  } catch {
    console.error("YouTube free search response was invalid");
    throw new YoutubeFreeApiError("YouTube 무료 소재 검색 응답을 확인하지 못했습니다.");
  }
}

async function requestVideoDetails(videoIds: string[], fetchImpl: typeof fetch) {
  if (!videoIds.length) return detailsResponseSchema.parse({ items: [] });
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("key", apiKey());
  endpoint.searchParams.set("part", "snippet,contentDetails,statistics,status,liveStreamingDetails");
  endpoint.searchParams.set("id", videoIds.join(","));
  endpoint.searchParams.set("maxResults", String(FREE_SEARCH_PAGE_SIZE));

  let response: Response;
  try {
    response = await fetchImpl(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    console.error("YouTube free detail connection failed");
    throw new YoutubeFreeApiError("YouTube 무료 소재 상세 정보에 연결하지 못했습니다.");
  }
  if (!response.ok) {
    console.error("YouTube free detail request failed", { status: response.status });
    throw new YoutubeFreeApiError("YouTube 무료 소재 상세 정보 요청에 실패했습니다.");
  }
  try {
    return detailsResponseSchema.parse(await response.json());
  } catch {
    console.error("YouTube free detail response was invalid");
    throw new YoutubeFreeApiError("YouTube 무료 소재 상세 응답을 확인하지 못했습니다.");
  }
}

function normalizeDetails(
  videoIds: string[],
  response: z.infer<typeof detailsResponseSchema>,
  pageNumber: number,
  rankOffset: number,
) {
  const detailsById = new Map(response.items.map((item) => [item.id, item]));
  const videos: StoredSearchVideo[] = [];
  videoIds.forEach((videoId, index) => {
    const item = detailsById.get(videoId);
    if (!item) return;
    const liveState = item.snippet.liveBroadcastContent;
    if (
      (liveState && liveState !== "none")
      || item.liveStreamingDetails !== undefined
      || item.status.privacyStatus !== "public"
      || item.status.embeddable === false
    ) return;
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
    if (!title || !channelName || !thumbnailUrl || !Number.isFinite(viewCount) || viewCount < 0 || durationSeconds <= 0) return;
    videos.push({
      videoId,
      category: categoryFromYoutube(item.snippet.categoryId),
      searchRank: rankOffset + index + 1,
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

export async function collectSearchVideoPages(options: {
  maxPages?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
  requestIntervalMs?: number;
  queries?: readonly string[];
} = {}) {
  const maxPages = Math.max(1, options.maxPages || 1);
  const now = options.now || new Date();
  const fetchImpl = options.fetchImpl || fetch;
  const requestIntervalMs = options.requestIntervalMs
    ?? (options.fetchImpl ? 0 : FREE_SEARCH_REQUEST_INTERVAL_MS);
  const videos = new Map<string, StoredSearchVideo>();
  const queries = options.queries?.length ? options.queries : FREE_SEARCH_QUERIES;
  const queryStates = queries.map((query) => ({
    query,
    pageToken: undefined as string | undefined,
    seenTokens: new Set<string>(),
    exhausted: false,
  }));
  let pageNumber = 0;
  let rankOffset = 0;

  while (pageNumber < maxPages && queryStates.some((state) => !state.exhausted)) {
    for (const state of queryStates) {
      if (pageNumber >= maxPages) break;
      if (state.exhausted) continue;
      if (pageNumber > 0 && requestIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, requestIntervalMs));
      }
      pageNumber += 1;
      const search = await requestFreeSearchPage({
        query: state.query,
        pageToken: state.pageToken,
        now,
        fetchImpl,
      });
      const videoIds = search.items.map((item) => item.id.videoId);
      const details = await requestVideoDetails(videoIds, fetchImpl);
      for (const video of normalizeDetails(videoIds, details, pageNumber, rankOffset)) {
        if (!videos.has(video.videoId)) videos.set(video.videoId, video);
      }
      rankOffset += videoIds.length;
      const nextPageToken = search.nextPageToken;
      if (nextPageToken && state.seenTokens.has(nextPageToken)) {
        throw new YoutubeFreeApiError("YouTube 무료 소재 페이지 토큰이 반복되어 수집을 중단했습니다.");
      }
      if (nextPageToken) state.seenTokens.add(nextPageToken);
      state.pageToken = nextPageToken;
      state.exhausted = !nextPageToken;
    }
  }

  const nextPageToken = queryStates.find((state) => state.pageToken)?.pageToken;
  return { pages: pageNumber, items: Array.from(videos.values()), nextPageToken };
}

async function startCollectionRun(db: Sql, now: Date) {
  try {
    return await db.begin(async (tx) => {
      await tx`
        update shorts_mvp.free_video_runs
        set status='failed', completed_at=${now}, error_message='stale_collection_lease'
        where status='collecting' and started_at < ${new Date(now.getTime() - 30 * 60_000)}
      `;
      const rows = await tx`
        insert into shorts_mvp.free_video_runs (snapshot_date, status, started_at, expires_at)
        values ((${now} at time zone 'Asia/Seoul')::date, 'collecting', ${now}, ${new Date(now.getTime() + 3 * 86_400_000)})
        returning id, snapshot_date::text as snapshot_date
      `;
      return { id: String(rows[0].id), snapshotDate: String(rows[0].snapshotDate) };
    });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "23505") {
      throw new FreeCollectionInProgressError();
    }
    throw error;
  }
}

function safeCollectionError(error: unknown) {
  if (error instanceof YoutubeFreeApiError || error instanceof FreeCollectionInProgressError) return error.message;
  return "무료 소재 수집 중 내부 오류가 발생했습니다.";
}

export async function collectFreeVideos(options: {
  db?: Sql;
  fetchImpl?: typeof fetch;
  now?: Date;
  maxPages?: number;
} = {}): Promise<FreeCollectionResult> {
  const db = options.db || getDb();
  const now = options.now || new Date();
  const run = await startCollectionRun(db, now);
  try {
    const collection = await collectSearchVideoPages({
      maxPages: options.maxPages,
      now,
      fetchImpl: options.fetchImpl,
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
          insert into shorts_mvp.free_video_items ${tx(
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
        update shorts_mvp.free_video_runs set
          status='ready', page_count=${collection.pages}, item_count=${collection.items.length},
          next_page_token=${collection.nextPageToken || null}, completed_at=${now}, error_message=null
        where id=${run.id}
      `;
      await tx`
        delete from shorts_mvp.free_video_runs
        where id <> ${run.id} and expires_at <= ${now}
      `;
    });
    return {
      runId: run.id,
      snapshotDate: run.snapshotDate,
      pages: collection.pages,
      items: collection.items.length,
      hasMoreOnYoutube: Boolean(collection.nextPageToken),
    };
  } catch (error) {
    await db`
      update shorts_mvp.free_video_runs
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
    throw new Error("무료 소재 페이지 정보가 올바르지 않습니다.");
  }
}

async function resolveReadyRun(db: Sql, requestedRunId?: string) {
  const rows = requestedRunId
    ? await db`
      select id, completed_at from shorts_mvp.free_video_runs
      where id=${requestedRunId} and status='ready' and expires_at > now()
      limit 1
    `
    : await db`
      select id, completed_at from shorts_mvp.free_video_runs
      where status='ready' and expires_at > now()
      order by completed_at desc
      limit 1
    `;
  if (!rows[0]) throw new FreeSnapshotUnavailableError();
  return { id: String(rows[0].id), completedAt: new Date(rows[0].completedAt).toISOString() };
}

function rowToPopularVideo(row: Record<string, unknown>): PopularVideo {
  return {
    videoId: String(row.videoId),
    category: z.enum(["entertainment", "gaming", "sports", "music", "news", "science", "howto"]).parse(row.category),
    title: String(row.title),
    channelName: String(row.channelName),
    thumbnailUrl: String(row.thumbnailUrl),
    durationSeconds: Number(row.durationSeconds),
    viewCount: Number(row.viewCount),
    publishedAt: new Date(String(row.publishedAt)).toISOString(),
    license: row.license === "creativeCommon" ? "creativeCommon" : "youtube",
  };
}

export async function getFreeVideos(
  koreanOnly: boolean,
  cursor?: string,
  limit = 50,
  db: Sql = getDb(),
): Promise<PopularVideoResponse> {
  const decodedCursor = decodeCursor(cursor);
  const run = await resolveReadyRun(db, decodedCursor?.runId);
  const offset = decodedCursor?.offset || 0;
  const rows = await db`
    select video_id, category, title, channel_name, thumbnail_url, duration_seconds,
      view_count, published_at, license, search_rank
    from shorts_mvp.free_video_items
    where run_id=${run.id}
      and (${koreanOnly}=false or is_korean)
    order by view_count desc, published_at desc, video_id asc
    offset ${offset}
    limit ${limit + 1}
  `;
  const hasNext = rows.length > limit;
  return {
    items: rows.slice(0, limit).map((row) => rowToPopularVideo(row as Record<string, unknown>)),
    updatedAt: run.completedAt,
    ...(hasNext ? { nextCursor: encodeCursor(run.id, offset + limit) } : {}),
  };
}

export async function getStoredFreeVideo(videoId: string, db: Sql = getDb()) {
  const rows = await db`
    select i.video_id, i.category, i.title, i.channel_name, i.thumbnail_url,
      i.duration_seconds, i.view_count, i.published_at, i.license
    from shorts_mvp.free_video_items i
    join shorts_mvp.free_video_runs r on r.id=i.run_id
    where i.video_id=${videoId} and r.status='ready' and r.expires_at > now()
    order by r.completed_at desc
    limit 1
  `;
  return rows[0] ? rowToPopularVideo(rows[0] as Record<string, unknown>) : null;
}
