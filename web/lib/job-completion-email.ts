import { Resend } from "resend";
import type { Sql } from "postgres";
import { absoluteUrl } from "@/lib/seo";

export type JobCompletionEmailClaim = {
  jobId: string;
  userId: string;
  recipientEmail: string;
  displayName: string | null;
  projectNumber: number;
  videoTitle: string;
  attemptCount: number;
  outputLanguage?: string;
};

export type JobCompletionEmailSender = (
  claim: JobCompletionEmailClaim,
) => Promise<string>;

const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 15, 60] as const;

const COMPLETION_COPY = {
  ko: {
    title: "이지컷 쇼츠 작업 완료", heading: "쇼츠 작업이 완료됐어요!",
    description: "요청하신 쇼츠를 모두 준비했습니다.", project: "프로젝트",
    action: "완성된 쇼츠 확인하기",
    footer: "이 메일은 이지컷에서 직접 요청하신 작업 완료 알림입니다.",
    subject: (number: number) => `[이지컷] 프로젝트 #${number} 쇼츠가 완성됐어요`,
  },
  ja: {
    title: "EasyCut ショート動画の作成が完了しました",
    heading: "ショート動画が完成しました！",
    description: "ご依頼のショート動画の作成がすべて完了しました。", project: "プロジェクト",
    action: "完成したショート動画を見る",
    footer: "このメールは、EasyCutでご依頼いただいた動画の作成完了をお知らせするものです。",
    subject: (number: number) => `[EasyCut] プロジェクト #${number} のショート動画が完成しました`,
  },
} as const;

function completionCopy(claim: JobCompletionEmailClaim) {
  const language = claim.outputLanguage === "ja" ? "ja" : "ko";
  return { language, ...COMPLETION_COPY[language] };
}

export function jobCompletionEmailSubject(claim: JobCompletionEmailClaim) {
  return completionCopy(claim).subject(claim.projectNumber);
}

export function jobCompletionEmailHtml(claim: JobCompletionEmailClaim) {
  const copy = completionCopy(claim);
  const projectUrl = absoluteUrl(`/projects/${claim.projectNumber}`);
  return `<!doctype html>
<html lang="${copy.language}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${copy.title}</title>
  </head>
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5">
      <tr>
        <td align="center" style="padding:36px 16px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid #e4e4e7;border-radius:20px;background:#ffffff">
            <tr>
              <td style="padding:36px 32px">
                <p style="margin:0 0 24px;color:#ef4444;font-size:14px;font-weight:800;letter-spacing:.08em">EASY CUT</p>
                <h1 style="margin:0;color:#18181b;font-size:28px;line-height:1.35;letter-spacing:-.03em">${copy.heading}</h1>
                <p style="margin:18px 0 0;color:#52525b;font-size:16px;line-height:1.75">${copy.description}</p>
                <div style="margin:24px 0;padding:18px 20px;border-radius:14px;background:#f4f4f5">
                  <p style="margin:0;color:#27272a;font-size:15px;font-weight:700">${copy.project} #${claim.projectNumber}</p>
                </div>
                <a href="${projectUrl}" style="display:block;padding:15px 22px;border-radius:12px;background:#18181b;color:#ffffff;font-size:15px;font-weight:800;text-align:center;text-decoration:none">${copy.action}</a>
                <p style="margin:28px 0 0;color:#a1a1aa;font-size:12px;line-height:1.7">${copy.footer}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function jobCompletionEmailText(claim: JobCompletionEmailClaim) {
  const copy = completionCopy(claim);
  return [
    copy.heading,
    "",
    `${copy.project} #${claim.projectNumber}`,
    "",
    `${copy.action}: ${absoluteUrl(`/projects/${claim.projectNumber}`)}`,
    "",
    copy.footer,
  ].join("\n");
}

export function jobCompletionEmailConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY?.trim()
    && process.env.RESEND_FROM_EMAIL?.trim(),
  );
}

export function createResendJobCompletionEmailSender(): JobCompletionEmailSender {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!apiKey || !from) {
    throw new Error("작업 완료 이메일 발송 환경변수가 설정되지 않았습니다.");
  }
  const resend = new Resend(apiKey);

  return async (claim) => {
    const { data, error } = await resend.emails.send({
      from,
      to: claim.recipientEmail,
      subject: jobCompletionEmailSubject(claim),
      html: jobCompletionEmailHtml(claim),
      text: jobCompletionEmailText(claim),
      tags: [
        { name: "category", value: "job-completion" },
        { name: "job_id", value: claim.jobId },
      ],
    }, {
      idempotencyKey: `job-completion-${claim.jobId}`,
    });
    if (error) {
      const errorName = typeof error.name === "string"
        ? error.name.slice(0, 80)
        : "ResendError";
      throw new Error(`Resend:${errorName}`);
    }
    if (!data?.id) throw new Error("Resend:MissingMessageId");
    return data.id;
  };
}

function safeErrorName(error: unknown) {
  const name = error instanceof Error ? error.message || error.name : "UnknownError";
  return name.replace(/[\r\n\t]/g, " ").slice(0, 160);
}

export async function processJobCompletionEmailNotifications(
  db: Sql,
  send: JobCompletionEmailSender,
  limit = 10,
) {
  const rows = await db`
    with claimed as materialized (
      select * from shorts_mvp.claim_job_completion_email_notifications(
        ${Math.max(1, Math.min(limit, 25))}
      )
    )
    select claimed.*, job.output_language as output_language
    from claimed
    join shorts_mvp.video_jobs job on job.id=claimed.job_id
  `;
  const claims: JobCompletionEmailClaim[] = rows.map((row) => ({
    jobId: String(row.jobId),
    userId: String(row.userId),
    recipientEmail: String(row.recipientEmail),
    displayName: row.displayName ? String(row.displayName) : null,
    projectNumber: Number(row.projectNumber),
    videoTitle: String(row.videoTitle),
    attemptCount: Number(row.attemptCount),
    outputLanguage: String(row.outputLanguage || "ko"),
  }));
  const result = { claimed: claims.length, sent: 0, retried: 0, failed: 0 };

  for (const claim of claims) {
    try {
      const providerMessageId = await send(claim);
      const updated = await db`
        update shorts_mvp.job_completion_email_notifications
        set status='sent',sent_at=clock_timestamp(),claimed_at=null,
            provider_message_id=${providerMessageId},last_error=null
        where job_id=${claim.jobId} and status='processing'
        returning job_id
      `;
      if (updated[0]) result.sent += 1;
    } catch (error) {
      const terminal = claim.attemptCount >= MAX_ATTEMPTS;
      const retryMinutes = RETRY_MINUTES[
        Math.min(Math.max(claim.attemptCount - 1, 0), RETRY_MINUTES.length - 1)
      ];
      const updated = await db`
        update shorts_mvp.job_completion_email_notifications
        set status=${terminal ? "failed" : "pending"},
            available_at=case
              when ${terminal} then available_at
              else clock_timestamp() + ${retryMinutes} * interval '1 minute'
            end,
            claimed_at=null,last_error=${safeErrorName(error)}
        where job_id=${claim.jobId} and status='processing'
        returning job_id
      `;
      if (updated[0]) {
        if (terminal) result.failed += 1;
        else result.retried += 1;
      }
    }
  }

  return result;
}
