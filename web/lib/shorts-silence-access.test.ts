import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Sql } from "postgres";
import { requireShortsSilenceAdmin, assertSilenceTemplate } from "./shorts-silence-access";
import { canSelectShortsSilence, shortsSilenceEnabled, shortsSilenceRequestSchema, silenceKeptRanges } from "./shorts-silence-contract";

afterEach(() => vi.unstubAllEnvs());
describe("administrator-only silence admission", () => {
  it("shows the option for the default automatic Korean input without enabling foreign-language combinations", () => {
    const input = { capability: true, customTemplate: false, snsTemplate: false, outputLanguage: "ko", sourceLanguage: "auto" };
    expect(canSelectShortsSilence(input)).toBe(true);
    expect(canSelectShortsSilence({ ...input, sourceLanguage: "ko" })).toBe(true);
    expect(canSelectShortsSilence({ ...input, sourceLanguage: undefined })).toBe(true);
    expect(canSelectShortsSilence({ ...input, capability: false })).toBe(false);
    expect(canSelectShortsSilence({ ...input, outputLanguage: "en" })).toBe(false);
    expect(canSelectShortsSilence({ ...input, sourceLanguage: "ja" })).toBe(false);
  });
  it.each([false, undefined, "true", 1])("rejects non-authoritative admin values %s", async value => {
    vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED", "true"); vi.stubEnv("RANKING_VERCEL_SNAPSHOT_ID", "snapshot");
    await expect(requireShortsSilenceAdmin((async () => [{ isAdmin: value, enabled: true }]) as unknown as Sql, "user"))
      .rejects.toMatchObject({ status: 404 });
  });
  it("requires the deployment gate and an existing analysis snapshot", async () => {
    const db = (async () => [{ isAdmin: true, enabled: true }]) as unknown as Sql;
    vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED", "false");
    await expect(requireShortsSilenceAdmin(db, "admin")).rejects.toMatchObject({ status: 404 });
    vi.stubEnv("ADMIN_SHORTS_SILENCE_ENABLED", "true"); vi.stubEnv("RANKING_VERCEL_SNAPSHOT_ID", "snapshot");
    await expect(requireShortsSilenceAdmin(db, "admin")).resolves.toBeUndefined();
    expect(shortsSilenceEnabled({ ADMIN_SHORTS_SILENCE_ENABLED: "true", RANKING_VERCEL_SNAPSHOT_ID: "snapshot", EASYCUT_ENVIRONMENT: "lab" })).toBe(false);
  });
  it("accepts only the fixed aggressive contract", () => {
    expect(shortsSilenceRequestSchema.safeParse({ version: 1, preset: "aggressive" }).success).toBe(true);
    for (const preset of ["relaxed", "medium", "", null]) expect(shortsSilenceRequestSchema.safeParse({ version: 1, preset }).success).toBe(false);
    expect(shortsSilenceRequestSchema.safeParse({ version: 1, preset: "aggressive", admin: true }).success).toBe(false);
  });
  it("does not combine unsupported private pipelines", () => {
    for (const input of [{ midform: {} }, { snsTemplate: true }, { languageTest: true }, { outputLanguage: "ja" }, { customTemplateId: "custom" }]) {
      expect(() => assertSilenceTemplate(input)).toThrow();
    }
    expect(() => assertSilenceTemplate({ outputLanguage: "ko" })).not.toThrow();
  });
});
describe("safe aggressive cuts", () => {
  it("cuts internal silence on the frame clock and retains both speech margins", () => {
    const ranges = silenceKeptRanges(2, 12, [[4, 6], [8, 10]]);
    expect(ranges).toHaveLength(3);
    expect(ranges[0][1]).toBeGreaterThanOrEqual(4.08);
    expect(ranges[1][0]).toBeLessThanOrEqual(5.92);
    expect(ranges[2][0]).toBeLessThanOrEqual(9.92);
    expect(ranges.at(-1)![1]).toBe(12);
  });
  it("preserves very short speech islands and fully silent input", () => {
    expect(silenceKeptRanges(0, 12, [[0, 12]])).toEqual([[0, 12]]);
    const ranges = silenceKeptRanges(0, 12, [[3, 5], [5.02, 6]]);
    expect(ranges.some(([a, b]) => a <= 5.01 && b >= 5.03)).toBe(true);
  });
  it("does not cut short pauses or exceed the editor clip limit", () => {
    expect(silenceKeptRanges(0, 10, [[2, 2.2]])).toEqual([[0, 10]]);
    const ranges = silenceKeptRanges(0, 180, Array.from({ length: 300 }, (_, i) => [i * .6 + .1, i * .6 + .5]));
    expect(ranges.length).toBeLessThanOrEqual(120);
    expect(ranges.every(([a,b]) => b-a>=.149)).toBe(true);
  });
});
