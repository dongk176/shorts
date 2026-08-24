import { describe, expect, it, vi } from "vitest";
import {
  createDefaultTemplateConfig,
  upgradeTemplateConfigToV5,
} from "./template-config";
import {
  resolveTemplateExecutionSnapshot,
  unifiedSubtitleSnapshotFromTemplateConfig,
} from "./template-execution-snapshot";

function dbWithRows(...responses: unknown[][]) {
  const tag = vi.fn();
  for (const response of responses) tag.mockResolvedValueOnce(response);
  Object.assign(tag, { json: (value: unknown) => value });
  return tag;
}

describe("template execution snapshot", () => {
  it("derives an immutable caption snapshot from the saved v5 subtitle layer", () => {
    const config = upgradeTemplateConfigToV5(
      createDefaultTemplateConfig("comment-capture"),
    );
    config.subtitle = {
      ...config.subtitle,
      visible: false,
      variant: "pop",
      y: 1_300,
      maxWidth: 760,
      fontSize: 88,
      color: "#FFFFFF",
      accentColor: "#FF715E",
    };

    const snapshot = unifiedSubtitleSnapshotFromTemplateConfig(config);
    expect(config.subtitle).not.toHaveProperty("backgroundColor");
    expect(snapshot).not.toHaveProperty("backgroundColor");
    expect(snapshot).toMatchObject({
      schemaVersion: 4,
      enabled: false,
      subtitleTemplateId: "pop",
      selectionId: "pop",
      videoAspectRatio: "16:9",
      font: { sizePx: 88 },
      color: { text: "#FFFFFF", active: "#FF715E" },
      maxWidthPx: 760,
      safeArea: { x: 160, y: 1_230, width: 760, height: 140 },
      layout: {
        caption: { x: 160, y: 1_230, width: 760, height: 140 },
      },
    });
  });

  it("does not consult canary access for a legacy personal template", async () => {
    const config = createDefaultTemplateConfig("white-yellow");
    const db = dbWithRows([{
      id: "3e5cd85c-03db-4f04-9854-c39b74486172",
      name: "기존 템플릿",
      baseTemplateId: "white-yellow",
      config,
      version: 4,
    }]);
    const access = vi.fn();

    await expect(resolveTemplateExecutionSnapshot(db as never, {
      userId: "8b849e2a-4339-4607-b705-8496265bf576",
      templateId: "dark-red",
      customTemplateId: "3e5cd85c-03db-4f04-9854-c39b74486172",
      videoAspectRatio: "9:16",
    }, access)).resolves.toMatchObject({
      resolvedTemplateId: "white-yellow",
      resolvedVideoAspectRatio: "5:4",
      subtitleTemplateSnapshot: null,
      usesUnifiedTemplateSubtitleCanary: false,
    });
    expect(access).not.toHaveBeenCalled();
  });

  it("rejects a separate brand color before loading a personal template", async () => {
    const db = dbWithRows();
    const access = vi.fn();

    await expect(resolveTemplateExecutionSnapshot(db as never, {
      userId: "8b849e2a-4339-4607-b705-8496265bf576",
      templateId: "dark-red",
      customTemplateId: "3e5cd85c-03db-4f04-9854-c39b74486172",
      videoAspectRatio: "9:16",
      brandColor: "#FF715E",
    }, access)).rejects.toMatchObject({
      status: 400,
      message: "내 템플릿에는 브랜드 컬러를 별도로 적용할 수 없습니다.",
    });
    expect(db).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
  });

  it("requires strict canary access even when saved subtitles are hidden", async () => {
    const config = upgradeTemplateConfigToV5(createDefaultTemplateConfig());
    config.subtitle.visible = false;
    const db = dbWithRows([{
      id: "3e5cd85c-03db-4f04-9854-c39b74486172",
      name: "통합 템플릿",
      baseTemplateId: "dark-minimal",
      config,
      version: 1,
    }]);
    const access = vi.fn().mockResolvedValue({ enabled: false });

    await expect(resolveTemplateExecutionSnapshot(db as never, {
      userId: "8b849e2a-4339-4607-b705-8496265bf576",
      templateId: "dark-minimal",
      customTemplateId: "3e5cd85c-03db-4f04-9854-c39b74486172",
      videoAspectRatio: "1:1",
    }, access)).rejects.toMatchObject({
      status: 403,
      code: "UNIFIED_TEMPLATE_SUBTITLE_CANARY_REQUIRED",
    });
  });

  it("gives link and local-upload creation the identical trusted v5 snapshot", async () => {
    const config = upgradeTemplateConfigToV5(
      createDefaultTemplateConfig("comment-capture"),
    );
    config.title.fontId = "paperlogy";
    config.subtitle = {
      ...config.subtitle,
      visible: true,
      variant: "highlight",
      y: 1_280,
      fontId: "paperlogy",
      fontSize: 84,
      color: "#FFFFFF",
      accentColor: "#35E6E3",
    };
    const row = {
      id: "3e5cd85c-03db-4f04-9854-c39b74486172",
      name: "댓글과 자막",
      baseTemplateId: "comment-capture",
      config,
      version: 7,
    };
    const db = dbWithRows([row], [row]);
    const access = vi.fn().mockResolvedValue({ unifiedEnabled: true });
    const input = {
      userId: "8b849e2a-4339-4607-b705-8496265bf576",
      templateId: "dark-red" as const,
      customTemplateId: row.id,
      videoAspectRatio: "9:16" as const,
    };

    const linkSnapshot = await resolveTemplateExecutionSnapshot(
      db as never,
      input,
      access,
    );
    const localUploadSnapshot = await resolveTemplateExecutionSnapshot(
      db as never,
      input,
      access,
    );

    expect(localUploadSnapshot).toEqual(linkSnapshot);
    expect(linkSnapshot).toMatchObject({
      resolvedTemplateId: "comment-capture",
      resolvedVideoAspectRatio: "16:9",
      usesUnifiedTemplateSubtitleCanary: true,
      subtitleTemplateSnapshot: {
        origin: "unified-template-v5",
        enabled: true,
        font: { id: "paperlogy", sizePx: 84 },
      },
    });
  });

  it("keeps regular preset execution on the existing snapshot contract", async () => {
    const db = dbWithRows();
    const access = vi.fn();
    await expect(resolveTemplateExecutionSnapshot(db as never, {
      userId: "8b849e2a-4339-4607-b705-8496265bf576",
      templateId: "dark-red",
      videoAspectRatio: "1:1",
    }, access)).resolves.toEqual({
      resolvedTemplateId: "dark-red",
      resolvedVideoAspectRatio: "1:1",
      templateSnapshot: { presetVersion: 3 },
      subtitleTemplateSnapshot: null,
      usesUnifiedTemplateSubtitleCanary: false,
    });
    expect(db).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
  });
});
