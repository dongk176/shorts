import "server-only";

import { unstable_cache } from "next/cache";
import { z } from "zod";
import type { Sql } from "postgres";
import type { ProjectListItem, ProjectListPage } from "@/lib/contracts";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { userFacingErrorMessage } from "@/lib/public-error";
import type { MvpSession } from "@/lib/session";

export const PROJECT_LIST_PAGE_SIZE = 12;

const projectCursorSchema = z.object({
  v: z.literal(1),
  isExample: z.boolean(),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

type ProjectCursor = z.infer<typeof projectCursorSchema>;

function encodeCursor(cursor: ProjectCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProjectCursor(value: string | null | undefined): ProjectCursor | null {
  if (!value) return null;
  try {
    return projectCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new HttpError(400, "프로젝트 목록 위치가 올바르지 않습니다.", "INVALID_PROJECT_CURSOR");
  }
}

function iso(value: unknown) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}

function mapProjectRow(row: Record<string, unknown>): ProjectListItem {
  const shorts = Array.isArray(row.shorts) ? row.shorts : [];
  return {
    id: String(row.id),
    projectNumber: Number(row.projectNumber),
    isExample: Boolean(row.isExample),
    videoTitle: String(row.videoTitle || ""),
    thumbnailUrl: String(row.thumbnailUrl || ""),
    sourceDurationSeconds: Number(row.sourceDurationSeconds || 0),
    status: String(row.status || "queued"),
    stage: String(row.stage || "queued"),
    stageCompletedCount: Number(row.stageCompletedCount || 0),
    stageTotalCount: Number(row.stageTotalCount || 0),
    errorMessage: row.errorMessage
      ? userFacingErrorMessage(
          String(row.errorMessage),
          "쇼츠 제작 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        )
      : null,
    createdAt: iso(row.createdAt),
    expiresAt: row.expiresAt ? iso(row.expiresAt) : null,
    shorts: shorts.map((short) => {
      const item = short as Record<string, unknown>;
      return {
        id: String(item.id),
        durationSeconds: Number(item.durationSeconds || 0),
        renderVersion: Number(item.renderVersion || 0),
        rerenderProgress: Number(item.rerenderProgress || 0),
        status: String(item.status || "ready"),
      };
    }),
  };
}

async function selectProjectPage(
  db: Sql,
  userId: string,
  cursor: ProjectCursor | null,
): Promise<ProjectListPage> {
  const rows = await db`
    with eligible as materialized (
      select job.id,job.project_number,job.is_example,job.video_title,
        job.thumbnail_url,job.source_duration_seconds,job.status,job.stage,
        job.stage_completed_count,job.stage_total_count,job.error_message,
        job.created_at,job.expires_at
      from shorts_mvp.video_jobs job
      where job.user_deleted_at is null
        and (job.user_id=${userId} or (job.is_example and job.status='completed'))
    ),
    paged as materialized (
      select *
      from eligible
      where ${cursor === null}
        or (
          case when is_example then 1 else 0 end,
          created_at,
          id
        ) < (
          ${cursor?.isExample ? 1 : 0}::integer,
          ${cursor?.createdAt ?? null}::timestamptz,
          ${cursor?.id ?? null}::uuid
        )
      order by is_example desc,created_at desc,id desc
      limit ${PROJECT_LIST_PAGE_SIZE + 1}
    )
    select paged.*,
      (select count(*)::integer from eligible) as total_count,
      coalesce(short_list.shorts,'[]'::jsonb) as shorts
    from paged
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id',generated_short.id,
          'durationSeconds',generated_short.duration_seconds,
          'renderVersion',generated_short.render_version,
          'rerenderProgress',generated_short.rerender_progress,
          'status',generated_short.status
        ) order by generated_short.clip_index
      ) as shorts
      from shorts_mvp.generated_shorts generated_short
      where generated_short.job_id=paged.id
        and generated_short.deleted_at is null
        and generated_short.status in ('ready','rerendering')
    ) short_list on true
    order by paged.is_example desc,paged.created_at desc,paged.id desc
  `;
  const hasMore = rows.length > PROJECT_LIST_PAGE_SIZE;
  const visibleRows = rows.slice(0, PROJECT_LIST_PAGE_SIZE);
  const projects = visibleRows.map((row) => mapProjectRow(row));
  const last = projects.at(-1);
  return {
    projects,
    totalCount: Number(rows[0]?.totalCount || 0),
    hasMore,
    nextCursor: hasMore && last
      ? encodeCursor({
          v: 1,
          isExample: last.isExample,
          createdAt: last.createdAt,
          id: last.id,
        })
      : null,
  };
}

export async function loadProjectListPage({
  session,
  cursor,
}: {
  session: MvpSession;
  cursor?: string | null;
}) {
  if (!session.userId) {
    throw new HttpError(401, "로그인이 필요합니다.");
  }
  return selectProjectPage(getDb(), session.userId, decodeProjectCursor(cursor));
}

export const loadPublicExampleProjectList = unstable_cache(async (): Promise<ProjectListPage> => {
  const rows = await getDb()`
    select job.id,job.project_number,job.is_example,job.video_title,
      job.thumbnail_url,job.source_duration_seconds,job.status,job.stage,
      job.stage_completed_count,job.stage_total_count,job.error_message,
      job.created_at,job.expires_at,
      coalesce(short_list.shorts,'[]'::jsonb) as shorts
    from shorts_mvp.video_jobs job
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id',generated_short.id,
          'durationSeconds',generated_short.duration_seconds,
          'renderVersion',generated_short.render_version,
          'rerenderProgress',generated_short.rerender_progress,
          'status',generated_short.status
        ) order by generated_short.clip_index
      ) as shorts
      from shorts_mvp.generated_shorts generated_short
      where generated_short.job_id=job.id
        and generated_short.deleted_at is null
        and generated_short.status in ('ready','rerendering')
    ) short_list on true
    where job.is_example and job.status='completed' and job.user_deleted_at is null
    order by job.created_at desc,job.id desc
    limit 10
  `;
  const projects = rows.map((row) => mapProjectRow(row));
  return {
    projects,
    totalCount: projects.length,
    hasMore: false,
    nextCursor: null,
  };
}, ["public-example-project-list-v1"], { revalidate: 300 });
