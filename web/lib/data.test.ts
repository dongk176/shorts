import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  getAllProjects,
  getGeneratedShortCount,
  getRecentJobs,
  getPublicExampleJobs,
  getPublicExampleProjectByNumber,
  getProjectByNumber,
  getShortsForJobs,
  getSubtitleTemplateUsage,
} from "./data";

const initialRenderSpec = {
  version: 4 as const,
  canvas: { width: 1080 as const, height: 1920 as const },
  fps: 30 as const,
  layerOrder: ["video", "title", "comment", "channel"],
  title: {
    visible: true,
    lines: ["후킹 제목"],
    centerX: 540,
    centerY: 200,
    offsetY: 0,
    fontSize: 84,
    scale: 1 as const,
    lineGap: 18,
    linePaddingX: 24,
    linePaddingY: 12,
    clamp: { minX: 0, maxX: 1080, minY: 0, maxY: 1920 },
    lineBoxes: [{
      text: "후킹 제목",
      centerX: 540,
      centerY: 200,
      width: 500,
      height: 100,
      baselineY: 220,
      backgroundRuns: [],
    }],
    font: {
      fontId: "pretendard" as const,
      fileId: "Pretendard-Bold.woff2",
      family: '"Editor V4 Pretendard"',
      requestedWeight: 700 as const,
      resolvedWeight: 700 as const,
      variableWeight: null,
      sha256: "4609c3356e536fafe38f4add0daeceb3d8595d3057bce13c428c33ddbd43d362",
      metrics: { revision: "editor-font-metrics-v2" as const },
    },
  },
  channel: {
    visible: true,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    font: {
      fontId: "pretendard" as const,
      fileId: "Pretendard-Bold.woff2",
      family: '"Editor V4 Pretendard"',
      requestedWeight: 700 as const,
      resolvedWeight: 700 as const,
      variableWeight: null,
      sha256: "4609c3356e536fafe38f4add0daeceb3d8595d3057bce13c428c33ddbd43d362",
      metrics: { revision: "editor-font-metrics-v2" as const },
    },
  },
  comments: [],
  textOverlays: [],
  video: { offsetX: 0, offsetY: 0, scale: 1 },
};

describe("generated shorts counter", () => {
  it("returns the persisted public counter as a number", async () => {
    const db = vi.fn().mockResolvedValue([{ value: "4327" }]) as unknown as Sql;

    await expect(getGeneratedShortCount(db)).resolves.toBe(4327);
  });
});

describe("project ownership queries", () => {
  const authenticatedUserId = "8b849e2a-4339-4607-b705-8496265bf576";

  it.each([
    ["all projects", (db: Sql) => getAllProjects(db, {
      id: "",
      selectedPlanCode: "free",
      userId: authenticatedUserId,
      user: null,
    })],
    ["recent projects", (db: Sql) => getRecentJobs(db, {
      id: "",
      selectedPlanCode: "free",
      userId: authenticatedUserId,
      user: null,
    })],
    ["one project", (db: Sql) => getProjectByNumber(db, {
      id: "",
      selectedPlanCode: "free",
      userId: authenticatedUserId,
      user: null,
    }, 6302)],
  ])("does not pass an empty anonymous session UUID for %s", async (_name, load) => {
    const db = vi.fn().mockResolvedValue([]) as unknown as Sql;

    await load(db);

    const values = (db as unknown as ReturnType<typeof vi.fn>).mock.calls[0].slice(1);
    expect(values).not.toContain("");
    expect(values).toContain(null);
  });
});

describe("subtitle template usage", () => {
  it("detects a previous subtitle-template job for onboarding", async () => {
    const db = vi.fn().mockResolvedValue([{ hasUsed: true }]) as unknown as Sql;

    await expect(getSubtitleTemplateUsage(db, "user-a")).resolves.toBe(true);
  });
});

describe("generated short details", () => {
  const shortRow = {
    id: "short-a",
    jobId: "job-a",
    clipIndex: 1,
    startSeconds: "12",
    endSeconds: "54",
    durationSeconds: "42",
    hookTitle: "후킹 제목",
    highlightReason: "",
    channelDisplayName: "채널",
    subtitleSegments: [],
    subtitlesEnabled: false,
    templateId: "dark-red",
    videoAspectRatio: "9:16",
    titleFontScale: "1",
    renderVersion: 1,
    rerenderProgress: 100,
    status: "ready",
    expiresAt: null,
  };

  it("maps the persisted Gemini highlight reason", async () => {
    const captionRenderSpec = {
      schemaVersion: 3,
      templateId: "highlight",
      captionPlacement: "center",
      fps: 30,
      timingLeadFrames: 4,
      safeArea: { x: 120, y: 1025, width: 840, height: 140 },
      font: {
        fontId: "pretendard",
        fileId: "Pretendard-Bold.woff2",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        family: "Pretendard",
        weight: 700,
      },
      style: {
        fontSize: 72,
        textColor: "#FFFFFF",
        accentColor: "#FFD84D",
        outlineColor: "#080808",
        outlineWidth: 7,
      },
      cues: [{
        startFrame: 0,
        endFrame: 30,
        fontSize: 72,
        centerX: 540,
        centerY: 1095,
        words: [{ text: "실제", spaceBefore: false }],
        lines: [[0]],
        events: [{
          startFrame: 0,
          endFrame: 30,
          activeWordIndex: 0,
        }],
      }],
    };
    const queryMock = vi.fn()
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([{
        id: "short-a",
        jobId: "job-a",
        clipIndex: 1,
        startSeconds: "12",
        endSeconds: "54",
        durationSeconds: "42",
        selectionRawStartSeconds: "10",
        selectionRawEndSeconds: "58",
        selectionRawDurationSeconds: "48",
        selectionCandidateIndex: 2,
        selectionLengthAdjustment: "none",
        selectionRepositioned: true,
        viralScore: "87",
        hookTitle: "후킹 제목",
        highlightReason: "반전이 드러나는 핵심 발언이 포함된 구간입니다.",
        channelDisplayName: "채널",
        subtitleSegments: [],
        subtitlesEnabled: false,
        templateId: "dark-red",
        subtitleTemplateId: "highlight",
        captionRenderSpec,
        wordTimedSubtitlesAvailable: true,
        videoAspectRatio: "9:16",
        titleFontScale: "1",
        titleTextStyles: [{ start: 0, end: 2, color: "#00FF00" }],
        renderVersion: 1,
        initialRenderSpec,
        rerenderProgress: 100,
        status: "ready",
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
      }])
      .mockReturnValueOnce(["job-a"])
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([{ id: "short-a" }]);
    const query = queryMock as unknown as Sql;

    const shorts = await getShortsForJobs(query, ["job-a"], {
      includeExactWordTimingAvailability: true,
    });

    expect(shorts.get("job-a")?.[0]?.highlightReason).toBe(
      "반전이 드러나는 핵심 발언이 포함된 구간입니다.",
    );
    expect(shorts.get("job-a")?.[0]?.titleTextStyles).toEqual([
      { start: 0, end: 2, color: "#00FF00" },
    ]);
    expect(shorts.get("job-a")?.[0]).toMatchObject({
      selectionRawStartSeconds: 10,
      selectionRawEndSeconds: 58,
      selectionRawDurationSeconds: 48,
      selectionCandidateIndex: 2,
      selectionLengthAdjustment: "none",
      selectionRepositioned: true,
      viralScore: 87,
      subtitleTemplateId: "highlight",
      captionRenderSpec,
      initialRenderSpec,
      wordTimedSubtitlesAvailable: true,
      editorApplyFailed: false,
    });
    const queryText = Array.from(
      queryMock.mock.calls[4][0] as TemplateStringsArray,
    ).join("");
    expect(queryText).toContain("selected_transcripts as materialized");
    expect(queryText).toContain("jsonb_array_elements(");
    expect(queryText).toContain(") word");
    expect(queryText).toContain("generated_short.edit_timeline_start_seconds");
    expect(queryText).toContain("generated_short.edit_timeline_end_seconds");
    const listQueryText = Array.from(
      queryMock.mock.calls[1][0] as TemplateStringsArray,
    ).join("");
    expect(listQueryText).not.toContain("jsonb_array_elements");
    expect(listQueryText).toContain("initial_render_spec");
    expect(listQueryText).toContain("render_error_code");
    expect(listQueryText).not.toContain("render_error_message");
  });

  it.each([
    ["ready", "rerender_batch_application", true],
    ["ready", "rerender_batch_infrastructure", true],
    ["ready", "rerender_batch_oom", true],
    ["ready", "editor_render_stale", true],
    ["ready", "editor_dispatch_failed", true],
    ["ready", "editor_batch_submit_failed", true],
    ["ready", null, false],
    ["ready", undefined, false],
    ["ready", "batch_application", false],
    ["ready", "batch_infrastructure", false],
    ["ready", "batch_oom", false],
    ["ready", "rerender_batch_unknown", false],
    ["ready", "editor_unknown", false],
    ["rerendering", "rerender_batch_application", false],
    ["rerendering", "rerender_batch_infrastructure", false],
    ["rerendering", "editor_render_stale", false],
    ["rerendering", null, false],
  ])("maps editor apply failure for status %s and code %s to %s", async (
    status, renderErrorCode, expected,
  ) => {
    const queryMock = vi.fn()
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([{ ...shortRow, status, renderErrorCode }]);

    const shorts = await getShortsForJobs(queryMock as unknown as Sql, ["job-a"]);

    expect(shorts.get("job-a")?.[0]?.editorApplyFailed).toBe(expected);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("exposes only a safe boolean, never persisted editor failure details", async () => {
    const renderErrorMessage = "ValidationError: private editor payload\n"
      + "Traceback at /private/worker.py\n"
      + "arn:aws:batch:ap-northeast-2:000000000000:job/private-job";
    const queryMock = vi.fn()
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([{
        ...shortRow,
        renderErrorCode: "rerender_batch_application",
        renderErrorMessage,
      }]);

    const shorts = await getShortsForJobs(queryMock as unknown as Sql, ["job-a"]);
    const short = shorts.get("job-a")?.[0];
    const response = JSON.stringify(short);

    expect(short?.editorApplyFailed).toBe(true);
    expect(short).not.toHaveProperty("renderErrorCode");
    expect(short).not.toHaveProperty("renderErrorMessage");
    expect(response).not.toContain("rerender_batch_application");
    expect(response).not.toContain("ValidationError");
    expect(response).not.toContain("Traceback");
    expect(response).not.toContain("arn:aws:");
    const queryText = Array.from(
      queryMock.mock.calls[1][0] as TemplateStringsArray,
    ).join("");
    expect(queryText).toContain("render_error_code");
    expect(queryText).not.toContain("render_error_message");
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("maps a permanent short without an expiry timestamp", async () => {
    const query = vi.fn()
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([{
        id: "short-a",
        jobId: "job-a",
        clipIndex: 1,
        startSeconds: "12",
        endSeconds: "54",
        durationSeconds: "42",
        hookTitle: "후킹 제목",
        highlightReason: "",
        channelDisplayName: "채널",
        subtitleSegments: [],
        subtitlesEnabled: false,
        templateId: "dark-red",
        videoAspectRatio: "9:16",
        titleFontScale: "1",
        renderVersion: 1,
        rerenderProgress: 100,
        status: "ready",
        expiresAt: null,
      }]) as unknown as Sql;

    const shorts = await getShortsForJobs(query, ["job-a"]);

    expect(shorts.get("job-a")?.[0]?.expiresAt).toBeNull();
  });
});

describe("public example projects", () => {
  it("marks the returned project as an example", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        id: "job-a",
        projectNumber: 1,
        isExample: true,
        videoTitle: "예시 영상",
        channelName: "채널",
        channelThumbnailUrl: null,
        thumbnailUrl: "https://example.com/thumb.jpg",
        sourceDurationSeconds: 600,
        outputLanguage: "ko",
        expectedShortCount: 12,
        status: "completed",
        stage: "completed",
        progress: 100,
        errorMessage: null,
        createdAt: new Date("2026-07-18T00:00:00.000Z"),
        expiresAt: null,
      }])
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([]) as unknown as Sql;

    const jobs = await getPublicExampleJobs(query);

    expect(jobs).toMatchObject([{ id: "job-a", projectNumber: 1, isExample: true, expiresAt: null }]);
  });

  it("loads one completed example by its public project number", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        id: "job-a",
        projectNumber: 1,
        isExample: true,
        videoTitle: "예시 영상",
        channelName: "채널",
        channelThumbnailUrl: null,
        thumbnailUrl: "https://example.com/thumb.jpg",
        sourceDurationSeconds: 600,
        outputLanguage: "ko",
        expectedShortCount: 12,
        status: "completed",
        stage: "completed",
        progress: 100,
        errorMessage: null,
        createdAt: new Date("2026-07-18T00:00:00.000Z"),
        expiresAt: null,
      }])
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([]) as unknown as Sql;

    const project = await getPublicExampleProjectByNumber(query, 1);

    expect(project).toMatchObject({ id: "job-a", projectNumber: 1, isExample: true });
  });
});

describe("all projects", () => {
  it("returns the complete available project list", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{
        id: "job-a",
        projectNumber: 11,
        isExample: false,
        videoTitle: "내 영상",
        channelName: "내 채널",
        channelThumbnailUrl: null,
        thumbnailUrl: "https://example.com/thumb.jpg",
        sourceDurationSeconds: 600,
        outputLanguage: "ko",
        expectedShortCount: 12,
        transcriptionPolicy: "elevenlabs_primary_openai_fallback",
        transcriptionProviderUsed: "mixed",
        transcriptionModelUsed: "scribe_v2+whisper-1",
        status: "completed",
        stage: "completed",
        progress: 100,
        errorMessage: null,
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
        expiresAt: new Date("2026-08-19T00:00:00.000Z"),
      }])
      .mockReturnValueOnce(["job-a"])
      .mockResolvedValueOnce([{
        id: "short-a",
        jobId: "job-a",
        clipIndex: 1,
        startSeconds: "12",
        endSeconds: "54",
        durationSeconds: "42",
        hookTitle: "후킹 제목",
        highlightReason: "",
        channelDisplayName: "채널",
        subtitleSegments: [],
        subtitlesEnabled: false,
        templateId: "dark-red",
        videoAspectRatio: "9:16",
        titleFontScale: "1",
        renderVersion: 1,
        rerenderProgress: 100,
        status: "ready",
        expiresAt: new Date("2026-08-19T00:00:00.000Z"),
      }]) as unknown as Sql;

    const projects = await getAllProjects(query, {
      id: "session-a",
      selectedPlanCode: "free",
      userId: "user-a",
      user: null,
    });

    expect(projects).toMatchObject([{
      id: "job-a",
      projectNumber: 11,
      isExample: false,
      wordTimedSubtitlesAvailable: true,
      expiresAt: "2026-08-19T00:00:00.000Z",
      shorts: [{ id: "short-a", wordTimedSubtitlesAvailable: true }],
    }]);
  });
});
