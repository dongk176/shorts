import { describe, expect, it, vi } from "vitest";
import {
  editorReleaseSupportsRenderSpecV3,
  editorReleaseSupportsRenderSpecV4,
  editorRenderSpecVersionForRelease,
  subtitleEditingReleaseEnabled,
  editorRenderingV2Enabled,
  editorRenderingV2GlobalEnabled,
  editorRenderingV2MasterEnabled,
  editorRenderingV2TestUserIds,
  resolveEditorRelease,
  resolvePublicEditorRelease,
  resolveRequestedEditorRelease,
} from "./editor-rendering-release";

const userId = "d164fb8d-d6e1-4232-8463-9115cdf7e561";
const releaseId = "438272ca-72f4-496e-a2dd-923f1cae586f";
const fontManifestSha256 = "a".repeat(64);

const legacyV4Capability = {
  renderSpecVersion: null,
  captionRenderSpecVersion: null,
  fontManifestSha256: null,
  renderV4Authorized: false,
};

function releaseRow(overrides: Record<string, unknown> = {}) {
  return {
    publicEnabled: false,
    canaryEnabled: false,
    runtimeEnabled: false,
    testerEnabled: false,
    userIsAdmin: false,
    stableReleaseId: null,
    stableUiVersion: null,
    stableDocumentVersion: null,
    stableStatus: null,
    stableSubtitleEditingCapable: false,
    stableRenderSpecVersion: null,
    stableCaptionRenderSpecVersion: null,
    stableFontManifestSha256: null,
    candidateReleaseId: null,
    candidateUiVersion: null,
    candidateDocumentVersion: null,
    candidateStatus: null,
    candidateSubtitleEditingCapable: false,
    candidateRenderSpecVersion: null,
    candidateCaptionRenderSpecVersion: null,
    candidateFontManifestSha256: null,
    subtitleEditingPublicEnabled: false,
    renderV4InternalEnabled: false,
    renderV4RolloutPercent: 0,
    renderV4KillSwitch: true,
    renderV4RolloutBucket: 99,
    ...overrides,
  };
}

describe("editor release gate", () => {
  it("uses render spec v3 only for a renderer release that passed its probe", () => {
    const base = {
      channel: "stable" as const,
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: true,
      subtitleEditingPublicEnabled: true,
    };
    const verified = {
      ...base,
      channel: "canary" as const,
      releaseId: "28405fea-41bb-4151-b8c7-93e59a7b74b7",
    };
    const currentStable = {
      ...base,
      releaseId: "b0cd2a6b-5019-4b5c-87cb-57e2d0bdb4c0",
    };
    const unknown = { ...base, releaseId };

    expect(editorReleaseSupportsRenderSpecV3(verified)).toBe(true);
    expect(editorRenderSpecVersionForRelease(verified)).toBe(3);
    expect(editorReleaseSupportsRenderSpecV3(currentStable)).toBe(false);
    expect(editorRenderSpecVersionForRelease(currentStable)).toBe(2);
    expect(editorRenderSpecVersionForRelease(unknown)).toBe(2);
    expect(editorRenderSpecVersionForRelease({
      channel: "legacy",
      releaseId: null,
      uiVersion: null,
      documentVersion: null,
      subtitleEditingCapable: false,
      subtitleEditingPublicEnabled: false,
    })).toBe(2);
  });

  it("selects v4 only from the exact assigned 4/4/font capability", () => {
    const exactV4 = {
      channel: "stable" as const,
      releaseId,
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: true,
      subtitleEditingPublicEnabled: true,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      renderV4Authorized: true,
    };

    expect(editorReleaseSupportsRenderSpecV4(exactV4)).toBe(true);
    expect(editorRenderSpecVersionForRelease(exactV4)).toBe(4);

    for (const invalid of [
      { ...exactV4, documentVersion: 4 },
      { ...exactV4, renderSpecVersion: 3 },
      { ...exactV4, captionRenderSpecVersion: 3 },
      { ...exactV4, fontManifestSha256: "A".repeat(64) },
      { ...exactV4, fontManifestSha256: "a".repeat(63) },
      { ...exactV4, renderV4Authorized: false },
    ]) {
      expect(editorReleaseSupportsRenderSpecV4(invalid)).toBe(false);
      expect(editorRenderSpecVersionForRelease(invalid)).not.toBe(4);
    }
  });

  it("keeps the existing v3 release decision when v4 is not authorized", () => {
    const verifiedV3 = {
      channel: "stable" as const,
      releaseId: "28405fea-41bb-4151-b8c7-93e59a7b74b7",
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: true,
      subtitleEditingPublicEnabled: true,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      renderV4Authorized: false,
    };
    expect(editorReleaseSupportsRenderSpecV3(verifiedV3)).toBe(true);
    expect(editorRenderSpecVersionForRelease(verifiedV3)).toBe(3);
  });

  it("enables subtitle editing only for a capable canary or published stable", () => {
    expect(subtitleEditingReleaseEnabled({
      channel: "canary",
      releaseId,
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: true,
      subtitleEditingPublicEnabled: false,
    })).toBe(true);
    expect(subtitleEditingReleaseEnabled({
      channel: "stable",
      releaseId,
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: true,
      subtitleEditingPublicEnabled: false,
    })).toBe(false);
    expect(subtitleEditingReleaseEnabled({
      channel: "stable",
      releaseId,
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: true,
      subtitleEditingPublicEnabled: true,
    })).toBe(true);
    expect(subtitleEditingReleaseEnabled({
      channel: "canary",
      releaseId,
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: false,
      subtitleEditingPublicEnabled: true,
    })).toBe(false);
  });

  it("requires the server-side master switch", () => {
    expect(editorRenderingV2MasterEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(editorRenderingV2MasterEnabled({
      NODE_ENV: "production",
      EDITOR_RENDERING_V2_ENABLED: " true ",
    })).toBe(true);
  });

  it("accepts only UUID-shaped emergency tester ids", () => {
    const ids = editorRenderingV2TestUserIds({
      EDITOR_RENDERING_V2_TEST_USER_IDS: `bad,${userId}`,
    });
    expect([...ids]).toEqual([userId]);
  });

  it("requires a separate explicit switch for global rollout", () => {
    expect(editorRenderingV2GlobalEnabled({
      EDITOR_RENDERING_V2_ENABLED: "true",
    })).toBe(false);
    expect(editorRenderingV2GlobalEnabled({
      EDITOR_RENDERING_V2_GLOBAL_ENABLED: " true ",
    })).toBe(true);
  });

  it("does not query release state while the master switch is off", async () => {
    const db = vi.fn();
    await expect(resolveEditorRelease(db as never, userId, {})).resolves.toEqual({
      channel: "legacy",
      releaseId: null,
      uiVersion: null,
      documentVersion: null,
      subtitleEditingCapable: false,
      subtitleEditingPublicEnabled: false,
      ...legacyV4Capability,
    });
    expect(db).not.toHaveBeenCalled();
  });

  it("keeps ordinary users on the legacy editor before public promotion", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow()]);
    await expect(resolveEditorRelease(
      db as never,
      userId,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    )).resolves.toMatchObject({ channel: "legacy" });
  });

  it("assigns an enabled administrator tester to the active candidate", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow({
      canaryEnabled: true,
      testerEnabled: true,
      userIsAdmin: true,
      candidateReleaseId: releaseId,
      candidateUiVersion: 2,
      candidateDocumentVersion: 2,
      candidateStatus: "canary_active",
    })]);
    await expect(resolveEditorRelease(
      db as never,
      userId,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    )).resolves.toEqual({
      channel: "canary",
      releaseId,
      uiVersion: 2,
      documentVersion: 2,
      subtitleEditingCapable: false,
      subtitleEditingPublicEnabled: false,
      ...legacyV4Capability,
    });
  });

  it("assigns v3 only to the enabled administrator canary tester", async () => {
    const candidate = releaseRow({
      canaryEnabled: true,
      testerEnabled: true,
      userIsAdmin: true,
      candidateReleaseId: releaseId,
      candidateUiVersion: 3,
      candidateDocumentVersion: 3,
      candidateStatus: "canary_active",
    });
    const adminDb = vi.fn().mockResolvedValue([candidate]);
    await expect(resolveEditorRelease(
      adminDb as never,
      userId,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    )).resolves.toEqual({
      channel: "canary",
      releaseId,
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: false,
      subtitleEditingPublicEnabled: false,
      ...legacyV4Capability,
    });

    const ordinaryDb = vi.fn().mockResolvedValue([releaseRow({
      ...candidate,
      testerEnabled: false,
      userIsAdmin: false,
    })]);
    await expect(resolveEditorRelease(
      ordinaryDb as never,
      userId,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    )).resolves.toMatchObject({ channel: "legacy", documentVersion: null });
  });

  it("keeps a non-administrator tester on the legacy editor", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow({
      canaryEnabled: true,
      testerEnabled: true,
      userIsAdmin: false,
      candidateReleaseId: releaseId,
      candidateUiVersion: 2,
      candidateDocumentVersion: 2,
      candidateStatus: "canary_active",
    })]);
    await expect(resolveEditorRelease(
      db as never,
      userId,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    )).resolves.toMatchObject({ channel: "legacy" });
  });

  it("admits a non-administrator tester only to a subtitle-capable candidate", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow({
      canaryEnabled: true,
      testerEnabled: true,
      userIsAdmin: false,
      candidateReleaseId: releaseId,
      candidateUiVersion: 3,
      candidateDocumentVersion: 3,
      candidateStatus: "canary_active",
      candidateSubtitleEditingCapable: true,
    })]);
    await expect(resolveEditorRelease(
      db as never,
      userId,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    )).resolves.toMatchObject({
      channel: "canary",
      releaseId,
      subtitleEditingCapable: true,
    });
  });

  it("allows an administrator emergency env tester only when a candidate is active", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow({
      canaryEnabled: true,
      userIsAdmin: true,
      candidateReleaseId: releaseId,
      candidateUiVersion: 2,
      candidateDocumentVersion: 2,
      candidateStatus: "canary_ready",
    })]);
    await expect(resolveEditorRelease(
      db as never,
      userId,
      {
        EDITOR_RENDERING_V2_ENABLED: "true",
        EDITOR_RENDERING_V2_TEST_USER_IDS: userId,
      },
    )).resolves.toMatchObject({ channel: "canary", releaseId });
  });

  it("ignores an emergency env tester that is not an administrator", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow({
      canaryEnabled: true,
      userIsAdmin: false,
      candidateReleaseId: releaseId,
      candidateUiVersion: 2,
      candidateDocumentVersion: 2,
      candidateStatus: "canary_ready",
    })]);
    await expect(resolveEditorRelease(
      db as never,
      userId,
      {
        EDITOR_RENDERING_V2_ENABLED: "true",
        EDITOR_RENDERING_V2_TEST_USER_IDS: userId,
      },
    )).resolves.toMatchObject({ channel: "legacy" });
  });

  it("authorizes v4 for a persisted internal tester on an exact candidate", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow({
      canaryEnabled: true,
      testerEnabled: true,
      userIsAdmin: true,
      candidateReleaseId: releaseId,
      candidateUiVersion: 3,
      candidateDocumentVersion: 3,
      candidateStatus: "canary_active",
      candidateRenderSpecVersion: 4,
      candidateCaptionRenderSpecVersion: 4,
      candidateFontManifestSha256: fontManifestSha256,
      renderV4InternalEnabled: true,
      renderV4KillSwitch: false,
    })]);

    const assignment = await resolveEditorRelease(
      db as never,
      userId,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    );
    expect(assignment).toMatchObject({
      channel: "canary",
      releaseId,
      documentVersion: 3,
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      renderV4Authorized: true,
    });
    expect(editorRenderSpecVersionForRelease(assignment)).toBe(4);
  });

  it("keeps internal v4 closed for the kill switch and env-only testers", async () => {
    const exactCandidate = releaseRow({
      canaryEnabled: true,
      testerEnabled: true,
      userIsAdmin: true,
      candidateReleaseId: releaseId,
      candidateUiVersion: 3,
      candidateDocumentVersion: 3,
      candidateStatus: "canary_active",
      candidateRenderSpecVersion: 4,
      candidateCaptionRenderSpecVersion: 4,
      candidateFontManifestSha256: fontManifestSha256,
      renderV4InternalEnabled: true,
      renderV4KillSwitch: true,
    });
    const killed = await resolveEditorRelease(
      vi.fn().mockResolvedValue([exactCandidate]) as never,
      userId,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    );
    expect(killed).toMatchObject({
      channel: "canary",
      renderSpecVersion: 4,
      renderV4Authorized: false,
    });
    expect(editorRenderSpecVersionForRelease(killed)).not.toBe(4);

    const emergencyOnly = await resolveEditorRelease(
      vi.fn().mockResolvedValue([releaseRow({
        ...exactCandidate,
        testerEnabled: false,
        renderV4KillSwitch: false,
      })]) as never,
      userId,
      {
        EDITOR_RENDERING_V2_ENABLED: "true",
        EDITOR_RENDERING_V2_TEST_USER_IDS: userId,
      },
    );
    expect(emergencyOnly).toMatchObject({
      channel: "canary",
      renderV4Authorized: false,
    });
  });

  it("assigns stable only after every public gate is enabled", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow({
      publicEnabled: true,
      runtimeEnabled: true,
      stableReleaseId: releaseId,
      stableUiVersion: 2,
      stableDocumentVersion: 2,
      stableStatus: "stable",
    })]);
    const environment = {
      EDITOR_RENDERING_V2_ENABLED: "true",
      EDITOR_RENDERING_V2_GLOBAL_ENABLED: "true",
    };
    await expect(resolveEditorRelease(
      db as never,
      userId,
      environment,
    )).resolves.toEqual({
      channel: "stable",
      releaseId,
      uiVersion: 2,
      documentVersion: 2,
      subtitleEditingCapable: false,
      subtitleEditingPublicEnabled: false,
      ...legacyV4Capability,
    });
    await expect(editorRenderingV2Enabled(
      db as never,
      userId,
      environment,
    )).resolves.toBe(true);
  });

  it("uses the database rollout bucket for an exact stable v4 release", async () => {
    const environment = {
      EDITOR_RENDERING_V2_ENABLED: "true",
      EDITOR_RENDERING_V2_GLOBAL_ENABLED: "true",
    };
    const stableV4 = releaseRow({
      publicEnabled: true,
      runtimeEnabled: true,
      stableReleaseId: releaseId,
      stableUiVersion: 3,
      stableDocumentVersion: 3,
      stableStatus: "stable",
      stableRenderSpecVersion: 4,
      stableCaptionRenderSpecVersion: 4,
      stableFontManifestSha256: fontManifestSha256,
      renderV4RolloutPercent: 5,
      renderV4RolloutBucket: 4,
      renderV4KillSwitch: false,
    });

    const included = await resolveEditorRelease(
      vi.fn().mockResolvedValue([stableV4]) as never,
      userId,
      environment,
    );
    expect(included).toMatchObject({
      channel: "stable",
      renderSpecVersion: 4,
      captionRenderSpecVersion: 4,
      fontManifestSha256,
      renderV4Authorized: true,
    });
    expect(editorRenderSpecVersionForRelease(included)).toBe(4);

    for (const deniedState of [
      { renderV4RolloutPercent: 5, renderV4RolloutBucket: 5 },
      { renderV4RolloutPercent: 50, renderV4RolloutBucket: 0 },
      {
        renderV4RolloutPercent: 100,
        renderV4RolloutBucket: 99,
        renderV4KillSwitch: true,
      },
    ]) {
      const denied = await resolveEditorRelease(
        vi.fn().mockResolvedValue([releaseRow({
          ...stableV4,
          ...deniedState,
        })]) as never,
        userId,
        environment,
      );
      expect(denied).toMatchObject({
        channel: "stable",
        renderSpecVersion: 4,
        renderV4Authorized: false,
      });
      expect(editorRenderSpecVersionForRelease(denied)).not.toBe(4);
    }
  });

  it("fails v4 closed when any stable capability value is not exact", async () => {
    const environment = {
      EDITOR_RENDERING_V2_ENABLED: "true",
      EDITOR_RENDERING_V2_GLOBAL_ENABLED: "true",
    };
    const base = releaseRow({
      publicEnabled: true,
      runtimeEnabled: true,
      stableReleaseId: releaseId,
      stableUiVersion: 3,
      stableDocumentVersion: 3,
      stableStatus: "stable",
      stableRenderSpecVersion: 4,
      stableCaptionRenderSpecVersion: 4,
      stableFontManifestSha256: fontManifestSha256,
      renderV4RolloutPercent: 100,
      renderV4RolloutBucket: 99,
      renderV4KillSwitch: false,
    });

    for (const malformedCapability of [
      { stableRenderSpecVersion: 3 },
      { stableCaptionRenderSpecVersion: 3 },
      { stableFontManifestSha256: "A".repeat(64) },
      { stableFontManifestSha256: "a".repeat(63) },
    ]) {
      const assignment = await resolveEditorRelease(
        vi.fn().mockResolvedValue([releaseRow({
          ...base,
          ...malformedCapability,
        })]) as never,
        userId,
        environment,
      );
      expect(assignment.renderV4Authorized).toBe(false);
      expect(editorRenderSpecVersionForRelease(assignment)).not.toBe(4);
    }
  });

  it("never enables saving for an anonymous session", async () => {
    const db = vi.fn();
    await expect(resolveEditorRelease(
      db as never,
      null,
      { EDITOR_RENDERING_V2_ENABLED: "true" },
    )).resolves.toMatchObject({ channel: "legacy" });
    expect(db).not.toHaveBeenCalled();
  });

  it("resolves the published stable release without impersonating an anonymous user", async () => {
    const db = vi.fn().mockResolvedValue([releaseRow({
      publicEnabled: true,
      runtimeEnabled: true,
      stableReleaseId: releaseId,
      stableUiVersion: 3,
      stableDocumentVersion: 3,
      stableStatus: "stable",
      stableSubtitleEditingCapable: true,
      subtitleEditingPublicEnabled: true,
    })]);

    await expect(resolvePublicEditorRelease(
      db as never,
      {
        EDITOR_RENDERING_V2_ENABLED: "true",
        EDITOR_RENDERING_V2_GLOBAL_ENABLED: "true",
      },
    )).resolves.toEqual({
      channel: "stable",
      releaseId,
      uiVersion: 3,
      documentVersion: 3,
      subtitleEditingCapable: true,
      subtitleEditingPublicEnabled: true,
      ...legacyV4Capability,
    });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("advertises public v4 without a user bucket only at 100 percent", async () => {
    const environment = {
      EDITOR_RENDERING_V2_ENABLED: "true",
      EDITOR_RENDERING_V2_GLOBAL_ENABLED: "true",
    };
    const publicV4 = releaseRow({
      publicEnabled: true,
      runtimeEnabled: true,
      stableReleaseId: releaseId,
      stableUiVersion: 3,
      stableDocumentVersion: 3,
      stableStatus: "stable",
      stableRenderSpecVersion: 4,
      stableCaptionRenderSpecVersion: 4,
      stableFontManifestSha256: fontManifestSha256,
      renderV4RolloutPercent: 25,
      renderV4KillSwitch: false,
    });

    const partial = await resolvePublicEditorRelease(
      vi.fn().mockResolvedValue([publicV4]) as never,
      environment,
    );
    expect(partial).toMatchObject({
      channel: "stable",
      renderSpecVersion: 4,
      renderV4Authorized: false,
    });

    const complete = await resolvePublicEditorRelease(
      vi.fn().mockResolvedValue([releaseRow({
        ...publicV4,
        renderV4RolloutPercent: 100,
      })]) as never,
      environment,
    );
    expect(complete.renderV4Authorized).toBe(true);
    expect(editorRenderSpecVersionForRelease(complete)).toBe(4);
  });

  it("keeps an open previous stable UI on its own immutable worker release", async () => {
    const previousReleaseId = "7fd1c249-6cef-40f1-97d4-e4e6c837f60a";
    const db = vi.fn()
      .mockResolvedValueOnce([releaseRow({
        publicEnabled: true,
        runtimeEnabled: true,
        stableReleaseId: releaseId,
        stableUiVersion: 3,
        stableDocumentVersion: 2,
        stableStatus: "stable",
      })])
      .mockResolvedValueOnce([{
        id: previousReleaseId,
        uiVersion: 2,
        documentVersion: 2,
        status: "stable",
        publicEnabled: true,
        runtimeEnabled: true,
        subtitleEditingCapable: false,
        subtitleEditingPublicEnabled: false,
      }]);

    await expect(resolveRequestedEditorRelease(
      db as never,
      userId,
      {
        releaseId: previousReleaseId,
        channel: "stable",
        uiVersion: 2,
        documentVersion: 2,
      },
      {
        EDITOR_RENDERING_V2_ENABLED: "true",
        EDITOR_RENDERING_V2_GLOBAL_ENABLED: "true",
      },
    )).resolves.toEqual({
      channel: "stable",
      releaseId: previousReleaseId,
      uiVersion: 2,
      documentVersion: 2,
      subtitleEditingCapable: false,
      subtitleEditingPublicEnabled: false,
      ...legacyV4Capability,
    });
  });

  it("re-reads v4 capability and rollout state for a requested stable release", async () => {
    const previousReleaseId = "7fd1c249-6cef-40f1-97d4-e4e6c837f60a";
    const environment = {
      EDITOR_RENDERING_V2_ENABLED: "true",
      EDITOR_RENDERING_V2_GLOBAL_ENABLED: "true",
    };
    const current = releaseRow({
      publicEnabled: true,
      runtimeEnabled: true,
      stableReleaseId: releaseId,
      stableUiVersion: 3,
      stableDocumentVersion: 3,
      stableStatus: "stable",
    });
    const requested = {
      releaseId: previousReleaseId,
      channel: "stable" as const,
      uiVersion: 3,
      documentVersion: 3,
    };

    for (const [killSwitch, authorized] of [
      [false, true],
      [true, false],
    ] as const) {
      const db = vi.fn()
        .mockResolvedValueOnce([current])
        .mockResolvedValueOnce([{
          id: previousReleaseId,
          uiVersion: 3,
          documentVersion: 3,
          status: "stable",
          publicEnabled: true,
          runtimeEnabled: true,
          subtitleEditingCapable: true,
          subtitleEditingPublicEnabled: true,
          renderSpecVersion: 4,
          captionRenderSpecVersion: 4,
          fontManifestSha256,
          renderV4RolloutPercent: 25,
          renderV4RolloutBucket: 24,
          renderV4KillSwitch: killSwitch,
        }]);
      const assignment = await resolveRequestedEditorRelease(
        db as never,
        userId,
        requested,
        environment,
      );
      expect(db).toHaveBeenCalledTimes(2);
      expect(assignment).toMatchObject({
        releaseId: previousReleaseId,
        renderSpecVersion: 4,
        captionRenderSpecVersion: 4,
        fontManifestSha256,
        renderV4Authorized: authorized,
      });
      expect(editorRenderSpecVersionForRelease(assignment)).toBe(
        authorized ? 4 : 2,
      );
    }
  });

  it("rejects an open release after that release has been rolled back", async () => {
    const previousReleaseId = "7fd1c249-6cef-40f1-97d4-e4e6c837f60a";
    const db = vi.fn()
      .mockResolvedValueOnce([releaseRow({
        publicEnabled: true,
        runtimeEnabled: true,
        stableReleaseId: releaseId,
        stableUiVersion: 3,
        stableDocumentVersion: 2,
        stableStatus: "stable",
      })])
      .mockResolvedValueOnce([{
        id: previousReleaseId,
        uiVersion: 2,
        documentVersion: 2,
        status: "rolled_back",
        publicEnabled: true,
        runtimeEnabled: true,
        subtitleEditingCapable: false,
        subtitleEditingPublicEnabled: false,
      }]);

    await expect(resolveRequestedEditorRelease(
      db as never,
      userId,
      {
        releaseId: previousReleaseId,
        channel: "stable",
        uiVersion: 2,
        documentVersion: 2,
      },
      {
        EDITOR_RENDERING_V2_ENABLED: "true",
        EDITOR_RENDERING_V2_GLOBAL_ENABLED: "true",
      },
    )).resolves.toMatchObject({ channel: "legacy" });
  });
});
