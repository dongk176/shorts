import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202608290001_file_upload_capacity_admission.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("file upload capacity admission migration", () => {
  it("adds a private queue without rewriting existing upload sessions", () => {
    expect(migration).toContain(
      "create table if not exists shorts_mvp.file_upload_capacity_requests",
    );
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("grant all on shorts_mvp.file_upload_capacity_requests to service_role");
    expect(migration).not.toMatch(/\bpublic\./i);
    expect(migration).not.toMatch(/\b(?:alter|update|delete\s+from|truncate)\s+shorts_mvp\.upload_sessions\b/i);
    expect(migration).not.toMatch(/\bdrop\s+(?:table|column)\b/i);
  });

  it("separates the thirty-minute queue from the fifteen-minute upload window", () => {
    expect(migration).toContain("queue_expires_at<=created_at + interval '30 minutes'");
    expect(migration).toContain("upload_expires_at<=granted_at + interval '15 minutes'");
    expect(migration).toContain("status in ('waiting','granted','cancelled','expired')");
  });
});
