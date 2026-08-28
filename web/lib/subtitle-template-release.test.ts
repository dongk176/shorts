import { readFileSync } from "node:fs";
import type { Sql, TransactionSql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  getEffectiveSubtitleTemplateAccess,
  getUnifiedTemplateSubtitlePublicPreviewAccess,
  lockEffectiveSubtitleTemplateAccess,
  resolveUnifiedTemplateSubtitleEditorContext,
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
const unifiedPublicFlagMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202608260003_unified_template_subtitles_public.sql",
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

  it("admits a regular member only through the independent stable public gate", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: false,
      unifiedPublicEnabled: true,
      publicEnabled: true,
      isAdmin: false,
      suitePublicEnabled: true,
    }).unifiedEnabled).toBe(true);
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: true,
      unifiedPublicEnabled: false,
      publicEnabled: true,
      isAdmin: false,
      suitePublicEnabled: true,
    }).unifiedEnabled).toBe(false);
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      unifiedCanaryEnabled: false,
      unifiedPublicEnabled: true,
      publicEnabled: true,
      isAdmin: false,
      suitePublicEnabled: false,
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

  it("resolves the editor release once inside the trusted canary context", async () => {
    const previousEditorMaster = process.env.EDITOR_RENDERING_V2_ENABLED;
    const previousSubtitleMaster = process.env.SUBTITLE_TEMPLATES_ENABLED;
    process.env.EDITOR_RENDERING_V2_ENABLED = "true";
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    const db = vi.fn()
      .mockResolvedValueOnce([
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: true },
        { flagKey: "unified_template_subtitles_canary", enabled: true },
      ])
      .mockResolvedValueOnce([{ isAdmin: true, testerEnabled: true }])
      .mockResolvedValueOnce([{
        publicEnabled: false,
        canaryEnabled: true,
        runtimeEnabled: false,
        testerEnabled: true,
        userIsAdmin: true,
        stableReleaseId: null,
        stableUiVersion: null,
        stableDocumentVersion: null,
        stableStatus: null,
        stableSubtitleEditingCapable: false,
        candidateReleaseId: "release-a",
        candidateUiVersion: 3,
        candidateDocumentVersion: 3,
        candidateStatus: "canary_ready",
        candidateSubtitleEditingCapable: true,
        subtitleEditingPublicEnabled: false,
      }]);
    try {
      const context = await resolveUnifiedTemplateSubtitleEditorContext(
        db as unknown as Sql,
        "user-a",
      );

      expect(context.editorRelease.channel).toBe("canary");
      expect(context.subtitleAccess.unifiedEnabled).toBe(true);
      expect(db).toHaveBeenCalledTimes(3);
    } finally {
      if (previousEditorMaster === undefined) {
        delete process.env.EDITOR_RENDERING_V2_ENABLED;
      } else {
        process.env.EDITOR_RENDERING_V2_ENABLED = previousEditorMaster;
      }
      if (previousSubtitleMaster === undefined) {
        delete process.env.SUBTITLE_TEMPLATES_ENABLED;
      } else {
        process.env.SUBTITLE_TEMPLATES_ENABLED = previousSubtitleMaster;
      }
    }
  });

  it.each([
    ["read", getEffectiveSubtitleTemplateAccess],
    ["locked mutation", lockEffectiveSubtitleTemplateAccess],
  ])(
    "falls back to the stable public subtitle release for an administrator %s",
    async (_label, resolveAccess) => {
      const previous = {
        editor: process.env.EDITOR_RENDERING_V2_ENABLED,
        global: process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED,
        subtitle: process.env.SUBTITLE_TEMPLATES_ENABLED,
      };
      process.env.EDITOR_RENDERING_V2_ENABLED = "true";
      process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED = "true";
      process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
      const flags = [
        { flagKey: "subtitle_templates", enabled: true },
        { flagKey: "subtitle_templates_public", enabled: true },
        { flagKey: "unified_template_subtitles_canary", enabled: false },
        { flagKey: "unified_template_subtitles_public", enabled: true },
      ];
      const db = vi.fn()
        .mockResolvedValueOnce(flags)
        .mockResolvedValueOnce([{ isAdmin: true, testerEnabled: true }])
        .mockResolvedValueOnce([{
          publicEnabled: true,
          canaryEnabled: true,
          runtimeEnabled: true,
          testerEnabled: true,
          userIsAdmin: true,
          stableReleaseId: "stable-release",
          stableUiVersion: 3,
          stableDocumentVersion: 3,
          stableStatus: "stable",
          stableSubtitleEditingCapable: true,
          candidateReleaseId: "candidate-release",
          candidateUiVersion: 3,
          candidateDocumentVersion: 3,
          candidateStatus: "canary_active",
          candidateSubtitleEditingCapable: true,
          subtitleEditingPublicEnabled: true,
        }])
        .mockResolvedValueOnce([{
          publicEnabled: true,
          runtimeEnabled: true,
          stableReleaseId: "stable-release",
          stableUiVersion: 3,
          stableDocumentVersion: 3,
          stableStatus: "stable",
          stableSubtitleEditingCapable: true,
          subtitleEditingPublicEnabled: true,
        }])
        .mockResolvedValueOnce(flags)
        .mockResolvedValueOnce([{ isAdmin: true, testerEnabled: true }]);
      try {
        const access = await resolveAccess(
          db as unknown as TransactionSql,
          "admin-user",
        );

        expect(access.unifiedEnabled).toBe(true);
        expect(access.unifiedCanaryEnabled).toBe(false);
        expect(access.unifiedPublicEnabled).toBe(true);
        expect(access.suitePublicEnabled).toBe(true);
        expect(db).toHaveBeenCalledTimes(6);
      } finally {
        if (previous.editor === undefined) delete process.env.EDITOR_RENDERING_V2_ENABLED;
        else process.env.EDITOR_RENDERING_V2_ENABLED = previous.editor;
        if (previous.global === undefined) delete process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED;
        else process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED = previous.global;
        if (previous.subtitle === undefined) delete process.env.SUBTITLE_TEMPLATES_ENABLED;
        else process.env.SUBTITLE_TEMPLATES_ENABLED = previous.subtitle;
      }
    },
  );

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

  it("seeds the independent public flag disabled without overwriting state", () => {
    expect(unifiedPublicFlagMigration).toContain(
      "'unified_template_subtitles_public'",
    );
    expect(unifiedPublicFlagMigration).toMatch(
      /'unified_template_subtitles_public',\s*false,/,
    );
    expect(unifiedPublicFlagMigration).toContain(
      "on conflict (flag_key) do nothing",
    );
    expect(unifiedPublicFlagMigration).not.toMatch(/\bpublic\./i);
  });

  it("shows anonymous previews only while every stable public ceiling is enabled", async () => {
    const previous = {
      subtitle: process.env.SUBTITLE_TEMPLATES_ENABLED,
      editor: process.env.EDITOR_RENDERING_V2_ENABLED,
      global: process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED,
    };
    process.env.SUBTITLE_TEMPLATES_ENABLED = "true";
    process.env.EDITOR_RENDERING_V2_ENABLED = "true";
    process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED = "true";
    const db = vi.fn().mockResolvedValue([{ enabled: true }]);
    try {
      await expect(getUnifiedTemplateSubtitlePublicPreviewAccess(
        db as unknown as Sql,
      )).resolves.toBe(true);
      expect(db).toHaveBeenCalledTimes(1);
    } finally {
      if (previous.subtitle === undefined) delete process.env.SUBTITLE_TEMPLATES_ENABLED;
      else process.env.SUBTITLE_TEMPLATES_ENABLED = previous.subtitle;
      if (previous.editor === undefined) delete process.env.EDITOR_RENDERING_V2_ENABLED;
      else process.env.EDITOR_RENDERING_V2_ENABLED = previous.editor;
      if (previous.global === undefined) delete process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED;
      else process.env.EDITOR_RENDERING_V2_GLOBAL_ENABLED = previous.global;
    }
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
