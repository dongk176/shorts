import { describe, expect, it, vi } from "vitest";
import {
  subtitleEditingReleaseEnabled,
  editorRenderingV2Enabled,
  editorRenderingV2GlobalEnabled,
  editorRenderingV2MasterEnabled,
  editorRenderingV2TestUserIds,
  resolveEditorRelease,
  resolveRequestedEditorRelease,
} from "./editor-rendering-release";

const userId = "d164fb8d-d6e1-4232-8463-9115cdf7e561";
const releaseId = "438272ca-72f4-496e-a2dd-923f1cae586f";

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
    candidateReleaseId: null,
    candidateUiVersion: null,
    candidateDocumentVersion: null,
    candidateStatus: null,
    candidateSubtitleEditingCapable: false,
    subtitleEditingPublicEnabled: false,
    ...overrides,
  };
}

describe("editor release gate", () => {
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
    });
    await expect(editorRenderingV2Enabled(
      db as never,
      userId,
      environment,
    )).resolves.toBe(true);
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
    });
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
