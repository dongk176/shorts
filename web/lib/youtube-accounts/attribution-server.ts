import "server-only";
import type { Sql } from "postgres";
import { z } from "zod";
import { withYoutubePurpose, youtubeRequest } from "@/lib/youtube-quota";
import type { YoutubeAttribution } from "./attribution";

const videoSchema = z.object({ items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string(), channelTitle: z.string() }), status: z.object({ privacyStatus: z.string(), license: z.string().optional() }) })) });
/** Called only after the owner's finished-source check, once when opening the panel. */
export async function sourceAttribution(db: Sql, userId: string, shortId: string): Promise<YoutubeAttribution | null> {
  const rows = await db`select j.youtube_video_id,
    case when coalesce(j.youtube_metadata_verified_at,j.created_at)>now()-interval '29 days' then j.video_title else '' end as title,
    case when coalesce(j.youtube_metadata_verified_at,j.created_at)>now()-interval '29 days' then j.channel_name else '' end as author,
    c.metadata
    from shorts_mvp.generated_shorts s join shorts_mvp.video_jobs j on j.id=s.job_id
    left join shorts_mvp.youtube_catalog c on c.video_id=j.youtube_video_id and c.availability='public'
      and c.verified_at>now()-interval '29 days' and c.metadata is not null and c.metadata_pending_at is null
    where s.id=${shortId} and s.user_id=${userId} and j.user_id=${userId} and j.source_type='youtube'
      and j.is_example=false and j.user_deleted_at is null and j.status<>'deleted' and s.deleted_at is null`;
  const row = rows[0];
  if (!row || !/^[A-Za-z0-9_-]{11}$/.test(String(row.youtubeVideoId))) return null;
  const id = String(row.youtubeVideoId), url = `https://www.youtube.com/watch?v=${id}`;
  if (row.metadata) return { title: String(row.metadata.title || row.title || ""), author: String(row.metadata.channelName || row.author || ""), url, ccBy: row.metadata.license === "creativeCommon" };
  const fallback = { title: String(row.title || ""), author: String(row.author || ""), url, ccBy: false };
  if (!process.env.YOUTUBE_API_KEY) return fallback;
  try {
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
    endpoint.searchParams.set("key", process.env.YOUTUBE_API_KEY);
    endpoint.searchParams.set("id", id); endpoint.searchParams.set("part", "snippet,status");
    const response = await withYoutubePurpose("refresh", db, () => youtubeRequest("refresh", endpoint, { cache: "no-store", signal: AbortSignal.timeout(10_000) }));
    if (!response.ok) return fallback;
    const video = videoSchema.parse(await response.json()).items.find(v => v.id === id);
    if (!video || video.status.privacyStatus !== "public") return { ...fallback, title: "", author: "" };
    return { title: video.snippet.title, author: video.snippet.channelTitle, url, ccBy: video.status.license === "creativeCommon" };
  } catch { return fallback; }
}
