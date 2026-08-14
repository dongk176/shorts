import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  jobCompletionEmailHtml,
  jobCompletionEmailText,
  processJobCompletionEmailNotifications,
  type JobCompletionEmailClaim,
} from "@/lib/job-completion-email";

const claim: JobCompletionEmailClaim = {
  jobId: "276a287d-8531-4cb5-9918-5811b12148e4",
  userId: "6f856acc-5b6a-4f62-9971-d7feb1f2a624",
  recipientEmail: "owner@example.com",
  displayName: "테스트 <사용자>",
  projectNumber: 12,
  videoTitle: "완성된 <쇼츠> & 테스트",
  attemptCount: 1,
};

function sqlWithRows(...responses: unknown[][]) {
  const sql = vi.fn();
  for (const response of responses) sql.mockResolvedValueOnce(response);
  return sql;
}

describe("job completion email", () => {
  it("includes only the project number and owned-project link", () => {
    const html = jobCompletionEmailHtml(claim);
    const text = jobCompletionEmailText(claim);
    expect(html).toContain("프로젝트 #12");
    expect(html).toContain("https://www.easycut.co.kr/projects/12");
    expect(html).not.toContain("테스트 <사용자>");
    expect(html).not.toContain("완성된 &lt;쇼츠&gt;");
    expect(html).toContain("직접 요청하신 작업 완료 알림");
    expect(text).not.toContain(claim.displayName || "");
    expect(text).not.toContain(claim.videoTitle);
  });

  it("marks a claimed notification sent after provider acceptance", async () => {
    const db = sqlWithRows([claim], [{ jobId: claim.jobId }]);
    const send = vi.fn().mockResolvedValue("provider-message-id");
    await expect(processJobCompletionEmailNotifications(
      db as unknown as Sql,
      send,
    )).resolves.toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 });
  });

  it("retries transient failures and stops after the fifth attempt", async () => {
    const transientDb = sqlWithRows([claim], [{ jobId: claim.jobId }]);
    await expect(processJobCompletionEmailNotifications(
      transientDb as unknown as Sql,
      vi.fn().mockRejectedValue(new Error("Resend:rate_limit_exceeded")),
    )).resolves.toEqual({ claimed: 1, sent: 0, retried: 1, failed: 0 });

    const terminalDb = sqlWithRows(
      [{ ...claim, attemptCount: 5 }],
      [{ jobId: claim.jobId }],
    );
    await expect(processJobCompletionEmailNotifications(
      terminalDb as unknown as Sql,
      vi.fn().mockRejectedValue(new Error("Resend:validation_error")),
    )).resolves.toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1 });
  });
});
