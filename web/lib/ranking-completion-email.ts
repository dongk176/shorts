import "server-only";
import { Resend } from "resend";
import { getDb } from "./db";
import { absoluteUrl } from "./seo";

export type RankingEmail = {
  operationId: string;
  projectId: string;
  email: string;
  attemptCount: number;
};
export function rankingEmailContent(claim: RankingEmail) {
  const url = absoluteUrl(
    `/ranking-shorts?project=${encodeURIComponent(claim.projectId)}&operation=${encodeURIComponent(claim.operationId)}`,
  );
  return {
    subject: "[이지컷] 랭킹 쇼츠가 완성됐어요",
    text: `랭킹 쇼츠 제작이 완료됐습니다.\n\n관리자 계정으로 로그인해 영상을 확인하고 다운로드하세요.\n${url}\n\n완성 영상은 작업 생성일로부터 30일간 보관됩니다.`,
  };
}
export async function processRankingEmails(
  send?: (claim: RankingEmail) => Promise<string>,
) {
  const db = getDb();
  await db`update shorts_mvp.ranking_completion_emails set status='failed',claimed_at=null,last_error='EmailDeliveryAttemptsExhausted'
    where status='processing' and attempt_count>=5 and claimed_at<now()-interval '5 minutes'`;
  // Recheck administrative membership and ownership at delivery, not only enqueue.
  await db`update shorts_mvp.ranking_completion_emails e set status='skipped',claimed_at=null
    from shorts_mvp.ranking_operations o,shorts_mvp.ranking_projects p,shorts_mvp.app_users u
    where e.operation_id=o.id and o.project_id=p.id and p.user_id=u.id and e.status in ('pending','processing')
    and (u.is_admin is not true or p.deleted_at is not null or p.expires_at<=now() or coalesce(u.email,'')='')`;
  const claims = await db.begin(async (tx) => {
    const rows =
      await tx`select e.operation_id,p.id as project_id,u.email,e.attempt_count
      from shorts_mvp.ranking_completion_emails e join shorts_mvp.ranking_operations o on o.id=e.operation_id
      join shorts_mvp.ranking_projects p on p.id=o.project_id join shorts_mvp.app_users u on u.id=p.user_id
      where o.status='succeeded' and u.is_admin=true and p.deleted_at is null and p.expires_at>now()
      and e.attempt_count<5 and ((e.status='pending' and e.available_at<=now()) or (e.status='processing' and e.claimed_at<now()-interval '5 minutes'))
      order by e.available_at for update of e skip locked limit 5`;
    for (const row of rows)
      await tx`update shorts_mvp.ranking_completion_emails set status='processing',attempt_count=attempt_count+1,claimed_at=now() where operation_id=${row.operationId}`;
    return rows.map((row) => ({
      operationId: String(row.operationId),
      projectId: String(row.projectId),
      email: String(row.email),
      attemptCount: Number(row.attemptCount) + 1,
    }));
  });
  const sender =
    send ||
    (async (claim: RankingEmail) => {
      const apiKey = process.env.RESEND_API_KEY,
        from = process.env.RESEND_FROM_EMAIL;
      if (!apiKey || !from) throw new Error("EmailNotConfigured");
      const { data, error } = await new Resend(apiKey).emails.send(
        { from, to: claim.email, ...rankingEmailContent(claim) },
        { idempotencyKey: `ranking-completion-${claim.operationId}` },
      );
      if (error || !data?.id) throw new Error("EmailProviderError");
      return data.id;
    });
  const result = { claimed: claims.length, sent: 0, failed: 0 };
  for (const claim of claims)
    try {
      const id = await sender(claim);
      await db`update shorts_mvp.ranking_completion_emails set status='sent',sent_at=now(),claimed_at=null,provider_message_id=${id},last_error=null where operation_id=${claim.operationId} and status='processing' and attempt_count=${claim.attemptCount}`;
      result.sent++;
    } catch {
      const terminal = claim.attemptCount >= 5;
      const delay = [1, 5, 15, 60][Math.min(claim.attemptCount - 1, 3)];
      await db`update shorts_mvp.ranking_completion_emails set status=${terminal ? "failed" : "pending"},claimed_at=null,available_at=now()+${delay}*interval '1 minute',last_error='EmailDeliveryFailed' where operation_id=${claim.operationId} and status='processing' and attempt_count=${claim.attemptCount}`;
      result.failed++;
    }
  return result;
}
