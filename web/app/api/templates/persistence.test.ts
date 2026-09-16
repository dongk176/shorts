import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultTemplateConfig, createUnifiedSubtitleTemplateConfig } from "@/lib/template-config";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, db: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db }));
vi.mock("@/lib/session", () => ({ requireAuthenticatedMvpSession: async () => ({ userId: "22222222-2222-4222-8222-222222222222" }) }));
vi.mock("@/lib/billing", () => ({ getBillingSummary: async () => ({}) }));
vi.mock("@/lib/template-entitlements", () => ({ assertCustomTemplateAccess: () => {} }));
vi.mock("@/lib/custom-template-design", () => ({ lockTemplateDesignForSave: async () => {} }));
vi.mock("@/lib/subtitle-template-release", () => ({
  getEffectiveSubtitleTemplateAccess: async () => ({ unifiedEnabled: true }),
  lockEffectiveSubtitleTemplateAccess: async () => ({ unifiedEnabled: true }),
}));
vi.mock("@/lib/read-request", () => ({ withReadRequest: async (_name: string, fn: (stage: (name: string, run: () => unknown) => unknown) => unknown) => fn((_name, run) => run()) }));
import { GET, POST } from "./route";
import { PUT } from "./[templateId]/route";
import { resolveTemplateExecutionSnapshot } from "@/lib/template-execution-snapshot";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  state.row = null;
  state.db.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
    const sql = parts.join("?");
    if (sql.includes("count(*)")) return [{ count: state.row ? 1 : 0 }];
    if (sql.includes("insert into")) {
      state.row = { id: ID, name: values[1], baseTemplateId: values[2], config: values[3], version: 1, createdAt: new Date(), updatedAt: new Date() };
    } else if (sql.includes("update shorts_mvp.custom_templates")) {
      state.row = { ...state.row, name: values[0], config: values[1], version: Number(state.row?.version) + 1 };
    }
    return state.row ? [structuredClone(state.row)] : [];
  });
  Object.assign(state.db, { begin: async (fn: (db: unknown) => unknown) => fn(state.db), json: (value: unknown) => structuredClone(value) });
});

describe("template save, reload and creation snapshot", () => {
  it.each([false, true])("retains edited controls through the real handlers (subtitle template: %s)", async (unified) => {
    const config = unified ? createUnifiedSubtitleTemplateConfig("highlight") : createDefaultTemplateConfig("comment-capture");
    const request = (value: unknown, method: string) => new Request("http://localhost/api/templates", { method, body: JSON.stringify(value), headers: { "Content-Type": "application/json" } });
    const created = await POST(request({ name: "저장 확인", baseTemplateId: "comment-capture", config }, "POST"));
    expect(created.status).toBe(201);
    config.title.y = 300;
    config.title.fontSize = 64;
    config.title.accentColor = "#FFD84D";
    config.channel.visible = false;
    config.comment.theme = "light";
    config.comment.size = "large";
    config.comment.dockedToVideo = false;
    config.comment.y = 1300;
    if (config.schemaVersion === 5) {
      config.subtitle.y = 1200;
      config.subtitle.fontSize = 80;
      config.subtitle.color = "#FFD84D";
    }
    const updated = await PUT(request({ name: "수정한 템플릿", config, version: 1 }, "PUT"), { params: Promise.resolve({ templateId: ID }) });
    expect(updated.status).toBe(200);
    const saved = (await updated.json()).template;
    expect(saved.config).toEqual(config);
    expect(saved.version).toBe(2);
    const listed = await GET(new Request("http://localhost/api/templates"));
    expect((await listed.json()).templates[0]).toEqual(saved);
    const execution = await resolveTemplateExecutionSnapshot(state.db as never, {
      userId: "22222222-2222-4222-8222-222222222222", templateId: "comment-capture", customTemplateId: ID, customTemplateVersion: 2, videoAspectRatio: "16:9",
    });
    expect(execution.templateSnapshot).toMatchObject({ version: 2, config });
    if (unified) expect(execution.subtitleTemplateSnapshot).toMatchObject({ font: { sizePx: 80 }, color: { text: "#FFD84D" } });
  });
});
