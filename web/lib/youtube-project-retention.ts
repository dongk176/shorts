import { z } from "zod";
import type { Sql } from "postgres";
import { getDb } from "@/lib/db";
import { withYoutubePurpose, youtubeRequest } from "@/lib/youtube-quota";
import { selectYoutubeThumbnail } from "@/lib/youtube-thumbnail";

const thumbnails = z.record(z.string(), z.object({ url: z.string().url() }));
const videosSchema = z.object({ items: z.array(z.object({
  id: z.string(),
  snippet: z.object({ title: z.string(), channelTitle: z.string(), channelId: z.string(), thumbnails }),
  status: z.object({ privacyStatus: z.string() }),
})) });
const channelsSchema = z.object({ items: z.array(z.object({
  id: z.string(), snippet: z.object({ thumbnails }),
})) });

export async function requestProjectMetadata(ids: string[], fetchImpl: typeof fetch = fetch) {
  async function request(resource: string, ids: string[], part: string) {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error("YouTube metadata credentials unavailable");
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.searchParams.set("key", key);
    url.searchParams.set("id", ids.join(","));
    url.searchParams.set("part", part);
    const response = await youtubeRequest("refresh", url, { cache: "no-store", signal: AbortSignal.timeout(15_000) }, fetchImpl);
    if (!response.ok) throw new Error("YouTube metadata refresh failed");
    return response.json();
  }
  if (!ids.length || ids.length > 50) throw new Error("Invalid metadata batch size");
  const videos = videosSchema.parse(await request("videos", ids, "snippet,status")).items;
  if (new Set(videos.map(v => v.id)).size !== videos.length || videos.some(v => !ids.includes(v.id)))
    throw new Error("Invalid metadata response IDs");
  const publicVideos = videos.filter(v => v.status.privacyStatus === "public");
  const channelIds = [...new Set(publicVideos.map(v => v.snippet.channelId))];
  const channels = channelIds.length
    ? channelsSchema.parse(await request("channels", channelIds, "snippet")).items : [];
  if (new Set(channels.map(c => c.id)).size !== channels.length || channels.some(c => !channelIds.includes(c.id)))
    throw new Error("Invalid channel response IDs");
  return new Map(publicVideos.map(v => [v.id, {
    title: v.snippet.title,
    channelName: v.snippet.channelTitle,
    thumbnailUrl: selectYoutubeThumbnail(v.snippet.thumbnails) || "",
    channelThumbnailUrl: selectYoutubeThumbnail(channels.find(c => c.id === v.snippet.channelId)?.snippet.thumbnails || {}) || null,
  }]));
}

/** Refresh at 25 days; remove unverified provider display fields at 29 days.
 * User-submitted source URLs, generated outputs, and job accounting are preserved.
 * The metadata age is independent of job updated_at (which changes during edits).
 */
export async function refreshProjectMetadata(options: {
  db?: Sql;
  fetchImpl?: typeof fetch;
  requestMetadata?: typeof requestProjectMetadata;
  /** One-off migration runner defers expiry until its bounded refresh pass ends. */
  deferExpiry?: boolean;
} = {}) {
  const db = options.db || getDb();
  const batch = await db.begin(async tx => {
    const rows = await tx`select id,youtube_video_id from shorts_mvp.video_jobs
      where source_type='youtube' and youtube_video_id is not null
        and coalesce(youtube_metadata_refresh_after,created_at+interval '25 days')<=clock_timestamp()
      order by coalesce(youtube_metadata_verified_at,created_at),id
      for update skip locked limit 50`;
    // Bind as text before casting: postgres.js otherwise JSON-encodes the string again.
    if (rows.length) await tx`update shorts_mvp.video_jobs
      set youtube_metadata_refresh_after=clock_timestamp()+interval '1 hour'
      where id::text in (select jsonb_array_elements_text(${JSON.stringify(rows.map(r => String(r.id)))}::text::jsonb))`;
    return rows;
  });
  let refreshed = 0, failed = false;
  if (batch.length) {
    try {
      const ids = [...new Set(batch.map(r => String(r.youtubeVideoId)))];
      const metadata = await withYoutubePurpose("refresh", db,
        () => (options.requestMetadata || requestProjectMetadata)(ids, options.fetchImpl || fetch));
      await db.begin(async tx => {
        // Update the claimed rows only; concurrent jobs can have newer source data.
        const changes = batch.map(row => {
          const item = metadata.get(String(row.youtubeVideoId));
          return { id: String(row.id), video_id: String(row.youtubeVideoId), title: item?.title || 'YouTube video',
            channel: item?.channelName || '', thumbnail: item?.thumbnailUrl || '', channel_thumbnail: item?.channelThumbnailUrl || null };
        });
        await tx`update shorts_mvp.video_jobs j set
            video_title=c.title,channel_name=c.channel,
            thumbnail_url=c.thumbnail,channel_thumbnail_url=c.channel_thumbnail,
            youtube_metadata_verified_at=clock_timestamp(),
            youtube_metadata_refresh_after=clock_timestamp()+interval '25 days'
            from jsonb_to_recordset(${JSON.stringify(changes)}::text::jsonb)
              as c(id text,video_id text,title text,channel text,thumbnail text,channel_thumbnail text)
            where j.id::text=c.id and j.source_type='youtube' and j.youtube_video_id=c.video_id`;
      });
      refreshed = batch.length;
    } catch { failed = true; }
  }
  // A failed API request is not evidence of deletion. Before the deadline keep
  // cached data for retry; after the deadline remove it regardless of failures.
  const expired = options.deferExpiry ? [] : await db`update shorts_mvp.video_jobs set video_title='YouTube video',
    channel_name='',thumbnail_url='',channel_thumbnail_url=null
    where source_type='youtube' and coalesce(youtube_metadata_verified_at,created_at)<clock_timestamp()-interval '29 days'
      and (video_title<>'YouTube video' or channel_name<>'' or thumbnail_url<>'' or channel_thumbnail_url is not null)
    returning id`;
  return { refreshed, expired: expired.length, failed };
}
