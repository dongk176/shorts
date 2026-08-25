import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("unified template subtitle public release", () => {
  it("keeps the administrator canary and stable public admission independent", () => {
    const release = source("web/lib/subtitle-template-release.ts");
    expect(release).toContain("UNIFIED_TEMPLATE_SUBTITLES_CANARY_FLAG_KEY");
    expect(release).toContain("UNIFIED_TEMPLATE_SUBTITLES_PUBLIC_FLAG_KEY");
    expect(release).toContain("allowAdministratorCanary");
    expect(release).toContain("getPublicSubtitleTemplateAccess");
  });

  it("gives regular sessions only the public access resolver", () => {
    const mvpState = source("web/lib/mvp-state.ts");
    const projectApi = source("web/app/api/projects/[projectNumber]/route.ts");
    expect(mvpState).toContain("session.isAdmin === true");
    expect(mvpState).toContain("getPublicSubtitleTemplateAccess");
    expect(projectApi).toContain("session.isAdmin === true");
    expect(projectApi).toContain("getPublicSubtitleTemplateAccess");
  });

  it("keeps file upload on its administrator-only and production-closed paths", () => {
    const mvpState = source("web/lib/mvp-state.ts");
    const release = source("web/lib/subtitle-template-release.ts");
    const migration = source("supabase/migrations/202608260003_unified_template_subtitles_public.sql");
    expect(mvpState).toContain("fileUpload: fileUploadAccess.adminEnabled");
    expect(release).toContain('environment.NODE_ENV === "production"');
    expect(migration).not.toContain("file_upload_public");
  });

  it("provides a reversible audited administrator control", () => {
    const actions = source("web/app/admin/easycutcutcutcutcutcut/editor-release-actions.ts");
    const dashboard = source("web/app/admin/easycutcutcutcutcutcut/admin-editor-releases.tsx");
    expect(actions).toContain("setUnifiedTemplateSubtitlePublic");
    expect(actions).toContain("editor_release.unified_template_subtitles_published");
    expect(actions).toContain("UNIFIED_TEMPLATE_SUBTITLES_JOB_DEFINITION_ARN");
    expect(dashboard).toContain("파일 업로드는 공개되지 않습니다");
    expect(dashboard).toContain("통합 자막 공개 중단");
  });
});
