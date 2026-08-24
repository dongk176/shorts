"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import {
  createCreatorProjectShareToken,
  creatorProjectShareTokenHash,
  CREATOR_PROJECT_SHARE_DAYS,
} from "@/lib/creator-project-shares";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";

const adminPath = "/admin/easycutcutcutcutcutcut";
const issueSchema = z.object({
  projectNumber: z.number().int().positive().safe(),
  recipientName: z.string().trim().min(1).max(100),
  rightsConfirmed: z.literal(true),
});
const shareIdSchema = z.string().uuid();

export type CreatorProjectShareIssueResult = {
  shareId: string;
  path: string;
  expiresAt: string;
};

export async function issueCreatorProjectShare(inputValue: {
  projectNumber: number;
  recipientName: string;
  rightsConfirmed: boolean;
}): Promise<CreatorProjectShareIssueResult> {
  const input = issueSchema.parse(inputValue);
  const admin = await requireAdminUser();
  const token = createCreatorProjectShareToken();
  const tokenHash = creatorProjectShareTokenHash(token);
  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() + CREATOR_PROJECT_SHARE_DAYS * 86_400_000,
  );

  const result = await getDb().begin(async (tx) => {
    const projectRows = await tx`
      select job.id,job.project_number,job.video_title,job.status,job.is_example,
        (select count(*)::integer
          from shorts_mvp.generated_shorts short
          where short.job_id=job.id and short.status='ready'
            and short.deleted_at is null
            and short.expires_at>clock_timestamp()) as ready_count,
        (select count(*)::integer
          from shorts_mvp.generated_shorts short
          where short.job_id=job.id and short.status='rerendering'
            and short.deleted_at is null) as rerendering_count,
        (select min(short.expires_at)
          from shorts_mvp.generated_shorts short
          where short.job_id=job.id and short.status='ready'
            and short.deleted_at is null
            and short.expires_at>clock_timestamp()) as media_expires_at
      from shorts_mvp.video_jobs job
      where job.project_number=${input.projectNumber}
        and job.user_id=${admin.id}
      limit 1
      for update of job
    `;
    const project = projectRows[0];
    if (!project) {
      throw new HttpError(404, "내가 만든 프로젝트를 찾을 수 없습니다.");
    }
    if (project.isExample) {
      throw new HttpError(409, "공개 예시 프로젝트는 전용 링크로 승격할 수 없습니다.");
    }
    if (project.status !== "completed") {
      throw new HttpError(409, "제작이 완료된 프로젝트만 전용 링크를 발급할 수 있습니다.");
    }
    if (Number(project.rerenderingCount || 0) > 0) {
      throw new HttpError(409, "수정 반영이 끝난 뒤 전용 링크를 발급해 주세요.");
    }
    if (Number(project.readyCount || 0) < 1 || !project.mediaExpiresAt) {
      throw new HttpError(409, "재생 가능한 쇼츠가 한 개 이상 필요합니다.");
    }
    if (new Date(project.mediaExpiresAt).getTime() < expiresAt.getTime()) {
      throw new HttpError(
        409,
        "영상 보관 기간이 7일보다 적게 남았습니다. 새 프로젝트로 다시 준비해 주세요.",
      );
    }

    const existingRows = await tx`
      select id from shorts_mvp.creator_project_shares
      where job_id=${project.id}
      limit 1
      for update
    `;
    const action = existingRows[0]
      ? "creator_project_share.reissued"
      : "creator_project_share.issued";
    const shareRows = await tx`
      insert into shorts_mvp.creator_project_shares (
        job_id,recipient_name,token_hash,created_by_user_id,issued_at,expires_at
      ) values (
        ${project.id},${input.recipientName},${tokenHash},${admin.id},
        ${issuedAt},${expiresAt}
      )
      on conflict (job_id) do update
      set recipient_name=excluded.recipient_name,
        token_hash=excluded.token_hash,
        created_by_user_id=excluded.created_by_user_id,
        issued_at=excluded.issued_at,
        expires_at=excluded.expires_at,
        revoked_at=null
      returning id
    `;
    const shareId = String(shareRows[0].id);
    await tx`
      insert into shorts_mvp.admin_audit_logs (
        actor_user_id,action,entity_type,entity_id,metadata
      ) values (
        ${admin.id},${action},'creator_project_share',${shareId},
        ${tx.json({
          projectNumber: input.projectNumber,
          expiresAt: expiresAt.toISOString(),
        })}
      )
    `;
    return shareId;
  });

  revalidatePath(adminPath);
  return {
    shareId: result,
    path: `/creator-project/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function revokeCreatorProjectShare(shareIdValue: string) {
  const shareId = shareIdSchema.parse(shareIdValue);
  const admin = await requireAdminUser();
  const revoked = await getDb().begin(async (tx) => {
    const rows = await tx`
      update shorts_mvp.creator_project_shares share
      set revoked_at=clock_timestamp()
      from shorts_mvp.video_jobs job
      where share.id=${shareId}
        and share.job_id=job.id
        and share.created_by_user_id=${admin.id}
        and share.revoked_at is null
      returning share.id,job.project_number
    `;
    if (!rows[0]) return false;
    await tx`
      insert into shorts_mvp.admin_audit_logs (
        actor_user_id,action,entity_type,entity_id,metadata
      ) values (
        ${admin.id},'creator_project_share.revoked',
        'creator_project_share',${shareId},
        ${tx.json({ projectNumber: Number(rows[0].projectNumber) })}
      )
    `;
    return true;
  });
  revalidatePath(adminPath);
  return { revoked };
}
