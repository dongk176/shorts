import { expectedShortCount, type YoutubeAnalysis } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import type { MvpSession } from "@/lib/session";
import { assertSupportedSourceVideoDuration } from "@/lib/source-video";

export type YoutubeAnalysisMetadata = Omit<YoutubeAnalysis, "analysisId" | "expectedShortCount">;

export async function createYoutubeAnalysis(
  session: MvpSession,
  metadata: YoutubeAnalysisMetadata,
): Promise<YoutubeAnalysis> {
  assertSupportedSourceVideoDuration(metadata.durationSeconds);
  const rows = await getDb()`
    insert into shorts_mvp.youtube_analyses (
      mvp_session_id, user_id, youtube_url, youtube_video_id, video_title,
      channel_name, channel_thumbnail_url, thumbnail_url, duration_seconds, creation_allowed,
      creation_block_code, creation_block_reason
    ) values (
      ${session.id}, ${session.userId}, ${metadata.normalizedUrl}, ${metadata.videoId}, ${metadata.title},
      ${metadata.channelName}, ${metadata.channelThumbnailUrl}, ${metadata.thumbnailUrl}, ${metadata.durationSeconds},
      ${metadata.creationAllowed}, ${metadata.creationBlockCode}, ${metadata.creationBlockReason}
    ) returning id
  `;
  return {
    ...metadata,
    analysisId: String(rows[0].id),
    expectedShortCount: expectedShortCount(metadata.durationSeconds),
  };
}

export async function getYoutubeAnalysis(session: MvpSession, analysisId: string): Promise<YoutubeAnalysis> {
  const rows = await getDb()`
    select id, youtube_url, youtube_video_id, video_title, channel_name,
      channel_thumbnail_url, thumbnail_url, duration_seconds, creation_allowed, creation_block_code,
      creation_block_reason
    from shorts_mvp.youtube_analyses
    where id=${analysisId} and expires_at > now() and (
      (${session.userId}::uuid is not null and user_id=${session.userId})
      or (${session.userId}::uuid is null and user_id is null and mvp_session_id=${session.id})
    )
    limit 1
  `;
  if (!rows[0]) throw new Error("영상 분석 정보를 찾을 수 없거나 만료되었습니다.");
  const durationSeconds = Number(rows[0].durationSeconds);
  return {
    analysisId: String(rows[0].id),
    videoId: String(rows[0].youtubeVideoId),
    normalizedUrl: String(rows[0].youtubeUrl),
    title: String(rows[0].videoTitle),
    channelName: String(rows[0].channelName),
    channelThumbnailUrl: rows[0].channelThumbnailUrl ? String(rows[0].channelThumbnailUrl) : null,
    thumbnailUrl: String(rows[0].thumbnailUrl),
    durationSeconds,
    expectedShortCount: expectedShortCount(durationSeconds),
    creationAllowed: rows[0].creationAllowed === true,
    creationBlockCode: rows[0].creationBlockCode || null,
    creationBlockReason: rows[0].creationBlockReason || null,
  };
}
