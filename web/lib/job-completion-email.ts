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
};

export type JobCompletionEmailSender = (
  claim: JobCompletionEmailClaim,
) => Promise<string>;

const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 5, 15, 60] as const;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function greetingName(displayName: string | null, email: string) {
  const value = displayName?.trim() || email.split("@", 1)[0]?.trim() || "고객";
  return value.slice(0, 80);
}

export function jobCompletionEmailHtml(claim: JobCompletionEmailClaim) {
  const projectUrl = absoluteUrl(`/projects/${claim.projectNumber}`);
  const name = escapeHtml(greetingName(claim.displayName, claim.recipientEmail));
  const title = escapeHtml(claim.videoTitle.slice(0, 200));
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>이지컷 쇼츠 작업 완료</title>
  </head>
  <body style="margin:0;background:#f4f4f5;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5">
      <tr>
        <td align="center" style="padding:36px 16px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid #e4e4e7;border-radius:20px;background:#ffffff">
            <tr>
              <td style="padding:36px 32px">
                <p style="margin:0 0 24px;color:#ef4444;font-size:14px;font-weight:800;letter-spacing:.08em">EASY CUT</p>
                <h1 style="margin:0;color:#18181b;font-size:28px;line-height:1.35;letter-spacing:-.03em">쇼츠 작업이 완료됐어요!</h1>
                <p style="margin:18px 0 0;color:#52525b;font-size:16px;line-height:1.75">${name}님이 요청하신 쇼츠를 모두 준비했습니다.</p>
                <div style="margin:24px 0;padding:18px 20px;border-radius:14px;background:#f4f4f5">
                  <p style="margin:0 0 6px;color:#71717a;font-size:12px;font-weight:700">프로젝트 #${claim.projectNumber}</p>
                  <p style="margin:0;color:#27272a;font-size:15px;font-weight:700;line-height:1.6">${title}</p>
                </div>
                <a href="${projectUrl}" style="display:block;padding:15px 22px;border-radius:12px;background:#18181b;color:#ffffff;font-size:15px;font-weight:800;text-align:center;text-decoration:none">완성된 쇼츠 확인하기</a>
                <p style="margin:28px 0 0;color:#a1a1aa;font-size:12px;line-height:1.7">이 메일은 이지컷에서 직접 요청하신 작업 완료 알림입니다.</p>
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
  const name = greetingName(claim.displayName, claim.recipientEmail);
  return [
    `${name}님, 쇼츠 작업이 완료됐어요!`,
    "",
    `프로젝트 #${claim.projectNumber}`,
    claim.videoTitle,
    "",
    `완성된 쇼츠 확인하기: ${absoluteUrl(`/projects/${claim.projectNumber}`)}`,
    "",
    "이 메일은 이지컷에서 직접 요청하신 작업 완료 알림입니다.",
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
      subject: `[이지컷] 프로젝트 #${claim.projectNumber} 쇼츠가 완성됐어요`,
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
    select * from shorts_mvp.claim_job_completion_email_notifications(
      ${Math.max(1, Math.min(limit, 25))}
    )
  `;
  const claims: JobCompletionEmailClaim[] = rows.map((row) => ({
    jobId: String(row.jobId),
    userId: String(row.userId),
    recipientEmail: String(row.recipientEmail),
    displayName: row.displayName ? String(row.displayName) : null,
    projectNumber: Number(row.projectNumber),
    videoTitle: String(row.videoTitle),
    attemptCount: Number(row.attemptCount),
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
