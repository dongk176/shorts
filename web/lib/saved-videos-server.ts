import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { catalogReadsEnabled } from "@/lib/youtube-quota";
import { catalogId } from "@/lib/youtube-catalog";
import { japanReadsEnabled } from "@/lib/youtube-japan-settings";
import { MAX_SAVED_VIDEOS, type SavedVideo } from "@/lib/saved-videos";

type SavedSql = Sql | TransactionSql;
// Read the live catalog instead of copying metadata into an indefinite archive.
// Keep its existing regional and 30-day visibility boundaries.
function available(db: SavedSql, includeJapan: boolean) {
  return db`${catalogReadsEnabled()} and c.availability='public' and c.metadata is not null and c.video_id is not null
    and c.verified_at > now() - interval '30 days'
    and (exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id and (r.region_code='KR' or ${includeJapan}))
      or not exists(select 1 from shorts_mvp.youtube_catalog_regions r where r.catalog_id=c.id))`;
}

export async function listSavedVideos(userId: string, db: SavedSql = getDb()): Promise<SavedVideo[]> {
  const includeJapan = await japanReadsEnabled(db);
  const rows = await db`select s.catalog_id as id, s.created_at as saved_at,
    case when ${available(db, includeJapan)} then c.metadata else null end as video,
    case when ${available(db, includeJapan)} then c.verified_at else null end as verified_at
    from shorts_mvp.saved_videos s left join shorts_mvp.youtube_catalog c on c.id=s.catalog_id
    where s.user_id=${userId} order by s.created_at desc,s.catalog_id desc limit ${MAX_SAVED_VIDEOS}`;
  return rows.map(row => ({
    id: String(row.id), savedAt: new Date(row.savedAt).toISOString(),
    video: row.video ? { ...row.video, verifiedAt: new Date(row.verifiedAt).toISOString(), isCurrentTrending: false } : null,
  }));
}

export async function saveVideo(userId: string, videoId: string, db: Sql = getDb()) {
  const id = catalogId(videoId);
  return db.begin(async tx => {
    // Serialize changes for this user so rapid requests cannot exceed the cap.
    await tx`select id from shorts_mvp.app_users where id=${userId} for update`;
    const existing = await tx`select catalog_id from shorts_mvp.saved_videos where user_id=${userId} and catalog_id=${id}`;
    if (existing.length) return { id };
    const [{ count }] = await tx`select count(*)::int as count from shorts_mvp.saved_videos where user_id=${userId}`;
    if (count >= MAX_SAVED_VIDEOS) throw new HttpError(409, "저장 가능한 개수를 초과했습니다.", "SAVED_VIDEO_LIMIT");
    const includeJapan = await japanReadsEnabled(tx);
    const inserted = await tx`insert into shorts_mvp.saved_videos(user_id,catalog_id)
      select ${userId},c.id from shorts_mvp.youtube_catalog c where c.id=${id} and c.video_id=${videoId} and ${available(tx, includeJapan)}
      on conflict(user_id,catalog_id) do nothing returning catalog_id`;
    if (!inserted.length) throw new HttpError(404, "현재 확인할 수 없는 영상입니다.", "VIDEO_UNAVAILABLE");
    return { id };
  });
}

export async function removeSavedVideo(userId: string, id: string, db: SavedSql = getDb()) {
  await db`delete from shorts_mvp.saved_videos where user_id=${userId} and catalog_id=${id}`;
}
