import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const createControlPlane = readFileSync(
  new URL("../../supabase/migrations/202608230003_file_upload_admin_control_plane.sql", import.meta.url),
  "utf8",
);
const prepareJobControl = readFileSync(
  new URL("../../supabase/migrations/202608230006_file_upload_job_control_plane.sql", import.meta.url),
  "utf8",
);
const validateJobControl = readFileSync(
  new URL("../../supabase/migrations/202608230007_file_upload_job_control_plane_validate.sql", import.meta.url),
  "utf8",
);

describe("file upload job-control migrations", () => {
  it("keeps the release inert and schema-qualified", () => {
    expect(createControlPlane).toContain("'file_upload',\n    false");
    expect(createControlPlane).toContain("'file_upload_public',\n    false");
    for (const migration of [createControlPlane, prepareJobControl, validateJobControl]) {
      expect(migration).toContain("shorts_mvp.");
      expect(migration).not.toMatch(/\bpublic\./);
    }
  });

  it("relaxes YouTube identity only behind a source-aware validated constraint", () => {
    expect(prepareJobControl).toContain("alter column youtube_url drop not null");
    expect(prepareJobControl).toContain("alter column youtube_video_id drop not null");
    expect(prepareJobControl).toContain("source_type='youtube'");
    expect(prepareJobControl).toContain("youtube_url is not null");
    expect(prepareJobControl).toContain("youtube_video_id is not null");
    expect(prepareJobControl).toContain("source_type='upload'");
    expect(prepareJobControl).toContain("youtube_url is null");
    expect(prepareJobControl).toContain("youtube_video_id is null");
    expect(prepareJobControl).toContain("execution_backend='upload_service'");
    expect(prepareJobControl).toContain("not valid");
    expect(validateJobControl).toContain(
      "validate constraint video_jobs_source_identity_v2_check",
    );
  });

  it("pins canonical thumbnails and a credential-free HTTPS receiver URL", () => {
    expect(prepareJobControl).toContain(
      "'/api/projects/' || project_number::text || '/source-thumbnail'",
    );
    expect(prepareJobControl).toContain("check (upload_url is null or upload_url ~ '^https://')");
    expect(prepareJobControl).toContain("token_hash is not null");
    expect(prepareJobControl).toContain("expires_at<=created_at + interval '15 minutes'");
    expect(validateJobControl).toContain("alter column token_hash set not null");
    expect(validateJobControl).toContain("alter column upload_url set not null");
  });

  it("enforces a one-to-one non-null job relationship without orphaning a session", () => {
    expect(createControlPlane).toContain("job_id uuid unique");
    expect(prepareJobControl).toContain("foreign key (job_id)");
    expect(prepareJobControl).toContain("on delete cascade not valid");
    expect(validateJobControl).toContain("validate constraint upload_sessions_job_id_fkey");
    expect(validateJobControl).toContain("alter column job_id set not null");
  });

  it("allows blank browser MIME declarations while retaining the hard metadata limits", () => {
    expect(prepareJobControl).toContain("char_length(declared_content_type)<=120");
    expect(createControlPlane).toContain("expected_bytes between 1 and 5368709120");
    expect(createControlPlane).toContain("declared_duration_seconds between 180 and 10800");
    expect(createControlPlane).toContain("range_end_seconds - range_start_seconds between 240 and 3600");
  });
});
