import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveSubtitleTemplateAccess,
  unifiedTemplateSubtitleLocalUploadEnabled,
} from "./subtitle-template-release";

const unifiedCanaryFlagMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202608240002_unified_template_subtitles_canary_flag.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("subtitle template release", () => {
  it("keeps the feature disabled when the environment master is off", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: false,
      featureEnabled: true,
      unifiedCanaryEnabled: true,
      publicEnabled: true,
      isAdmin: true,
    }).enabled).toBe(false);
  });

  it("requires an administrator who is assigned to the capable canary", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: true,
      publicEnabled: false,
      isAdmin: true,
      pilotEnabled: true,
    }).unifiedEnabled).toBe(true);
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: true,
      publicEnabled: false,
      isAdmin: false,
      pilotEnabled: true,
    }).unifiedEnabled).toBe(false);
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: true,
      publicEnabled: false,
      isAdmin: true,
      pilotEnabled: false,
    }).unifiedEnabled).toBe(false);
  });

  it("does not admit anyone while the runtime feature flag is off", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: false,
      unifiedCanaryEnabled: true,
      publicEnabled: true,
      isAdmin: true,
      pilotEnabled: true,
    }).unifiedEnabled).toBe(false);
  });

  it("rolls back only unified v5 access when its independent flag is off", () => {
    const access = resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: false,
      publicEnabled: true,
      isAdmin: true,
      pilotEnabled: true,
      suitePublicEnabled: true,
    });

    expect(access.enabled).toBe(true);
    expect(access.unifiedEnabled).toBe(false);
  });

  it("never lets public flags admit a member to the admin canary", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: true,
      publicEnabled: true,
      isAdmin: false,
      suitePublicEnabled: false,
    }).unifiedEnabled).toBe(false);
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: true,
      publicEnabled: true,
      isAdmin: false,
      suitePublicEnabled: true,
    }).unifiedEnabled).toBe(false);
  });

  it("rejects a selected non-admin pilot", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: true,
      publicEnabled: false,
      isAdmin: false,
      pilotEnabled: true,
    }).unifiedEnabled).toBe(false);
  });

  it("seeds the independent unified canary flag disabled without overwriting state", () => {
    expect(unifiedCanaryFlagMigration).toContain(
      "'unified_template_subtitles_canary'",
    );
    expect(unifiedCanaryFlagMigration).toMatch(
      /'unified_template_subtitles_canary',\s*false,/,
    );
    expect(unifiedCanaryFlagMigration).toContain(
      "on conflict (flag_key) do nothing",
    );
    expect(unifiedCanaryFlagMigration).not.toContain(
      "on conflict (flag_key) do update",
    );
    expect(unifiedCanaryFlagMigration).not.toMatch(/\bupdate\s+shorts_mvp\./i);
  });

  it("allows unified upload only for an explicit non-production loopback", () => {
    const base = {
      strictAccessEnabled: true,
      fileUploadAdminEnabled: true,
      environment: {
        NODE_ENV: "development",
        UNIFIED_TEMPLATE_SUBTITLE_LOCAL_UPLOAD_ENABLED: "true",
        FILE_UPLOAD_RECEIVER_URL: "https://127.0.0.1:4443",
      },
    };
    expect(unifiedTemplateSubtitleLocalUploadEnabled(base)).toBe(true);
    expect(unifiedTemplateSubtitleLocalUploadEnabled({
      ...base,
      environment: { ...base.environment, NODE_ENV: "production" },
    })).toBe(false);
    expect(unifiedTemplateSubtitleLocalUploadEnabled({
      ...base,
      environment: {
        ...base.environment,
        FILE_UPLOAD_RECEIVER_URL: "https://receiver.example.com",
      },
    })).toBe(false);
    expect(unifiedTemplateSubtitleLocalUploadEnabled({
      ...base,
      strictAccessEnabled: false,
    })).toBe(false);
  });
});
