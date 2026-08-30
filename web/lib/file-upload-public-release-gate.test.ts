import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/202608300001_file_upload_verified_release_gate.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("file upload verified public release gate", () => {
  it("locks flags and fresh evidence before changing public mode", () => {
    expect(migration).toContain("order by flag_key\n  for update");
    expect(migration).toContain("order by check_key\n    for share");
    expect(migration).toContain(
      "checked.verified_at>=clock_timestamp()-interval '24 hours'",
    );
    expect(migration).toContain("file upload public checks are incomplete");
  });

  it("requires one exact v4 upload identity and all five dispatch targets", () => {
    expect(migration).toContain("v_runtime_details->>'releaseId'");
    expect(migration).toContain("v_runtime_details->>'workerImageDigest'");
    expect(migration).toContain("v_runtime_details->>'fontManifestSha256'");
    expect(migration).toContain("v_runtime_details->>'renderSpecVersion'='4'");
    expect(migration).toContain("v_render_details->>'releaseId'");
    expect(migration).toContain("v_admin_details->>'sourceGitSha'");
    expect(migration).toContain("v_admin_details->>'releaseId'");
    expect(migration).toContain("v_target_count<>5");
    for (const target of [
      "legacy_project",
      "source_range",
      "elevenlabs_transcription",
      "subtitle_templates",
      "unified_template_subtitles",
    ]) {
      expect(migration).toContain(`'${target}'`);
    }
  });

  it("prevents unaudited evidence writes and live release replacement", () => {
    expect(migration).toContain(
      "revoke insert,update on shorts_mvp.file_upload_release_checks from service_role",
    );
    expect(migration).toContain(
      "stop public file upload before changing release identity",
    );
    expect(migration).toContain("'releaseId',v_release_id");
    expect(migration).not.toMatch(/\bdrop\s+(?:table|column|constraint)\b/i);
    expect(migration).not.toMatch(/\b(?:update|delete)\s+shorts_mvp\.video_jobs\b/i);
  });
});
