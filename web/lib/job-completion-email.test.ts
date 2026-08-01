import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  jobCompletionEmailHtml,
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
  it("escapes user-controlled content and links to the owned project", () => {
    const html = jobCompletionEmailHtml(claim);

    expect(html).toContain("테스트 &lt;사용자&gt;");
    expect(html).toContain("완성된 &lt;쇼츠&gt; &amp; 테스트");
    expect(html).toContain("https://www.easycut.co.kr/projects/12");
    expect(html).not.toContain("테스트 <사용자>");
  });

  it("marks a claimed notification sent after the provider accepts it", async () => {
    const db = sqlWithRows([claim], [{ jobId: claim.jobId }]);
    const send = vi.fn().mockResolvedValue("provider-message-id");

    const result = await processJobCompletionEmailNotifications(
      db as unknown as Sql,
      send,
    );

    expect(result).toEqual({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    expect(send).toHaveBeenCalledWith(claim);
    expect(db.mock.calls[1].slice(1)).toContain("provider-message-id");
  });

  it("returns a transient provider failure to the retry queue", async () => {
    const db = sqlWithRows([claim], [{ jobId: claim.jobId }]);
    const send = vi.fn().mockRejectedValue(new Error("Resend:rate_limit_exceeded"));

    const result = await processJobCompletionEmailNotifications(
      db as unknown as Sql,
      send,
    );

    expect(result).toEqual({ claimed: 1, sent: 0, retried: 1, failed: 0 });
    expect(db.mock.calls[1].slice(1)).toContain("pending");
    expect(db.mock.calls[1].slice(1)).toContain(1);
  });

  it("stops retrying after the fifth failed attempt", async () => {
    const finalClaim = { ...claim, attemptCount: 5 };
    const db = sqlWithRows([finalClaim], [{ jobId: claim.jobId }]);
    const send = vi.fn().mockRejectedValue(new Error("Resend:validation_error"));

    const result = await processJobCompletionEmailNotifications(
      db as unknown as Sql,
      send,
    );

    expect(result).toEqual({ claimed: 1, sent: 0, retried: 0, failed: 1 });
    expect(db.mock.calls[1].slice(1)).toContain("failed");
  });
});
