import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { PGlite } from "../../../test-tools/node_modules/@electric-sql/pglite/dist/index.js";
import { batchSchema, type GuideEvent } from "./schema";
import { saveGuideEvents } from "./store";
vi.mock("@/lib/db", () => ({ getDb: vi.fn() }));
import { getDb } from "@/lib/db";
import { POST } from "@/app/api/shorts-monetization/events/route";
let pg: PGlite;
let db: Sql;
const survey = randomUUID();
const complete = {
  category: "products",
  goal: "affiliate",
  stage: "none",
  source: "own",
  format: "hands",
  time: "short",
  readiness: "ready",
  obstacle: "ideas",
};
function event(sequence: number, extra: Partial<GuideEvent> = {}): GuideEvent {
  return {
    id: randomUUID(),
    surveyId: survey,
    sequence,
    name: "question_viewed",
    locale: "ko",
    version: "20260927",
    question: "category",
    answers: {},
    ...extra,
  };
}
function request(
  events: unknown[],
  origin = "http://localhost:3018",
  raw?: string,
) {
  return new Request("http://localhost:3018/api/shorts-monetization/events", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "sec-fetch-site": "same-origin",
    },
    body: raw ?? JSON.stringify({ events }),
  });
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    "create schema shorts_mvp; create role anon; create role authenticated; create role service_role bypassrls;",
  );
  const migration = readFileSync(
    path.resolve(
      "../supabase/migrations/202609270010_shorts_guide_analytics.sql",
    ),
    "utf8",
  );
  await pg.exec(migration);
  await pg.exec(migration);
  db = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.reduce(
      (text, piece, i) => text + (i ? `$${i}` : "") + piece,
      "",
    );
    return (await pg.query(query, values)).rows;
  }) as unknown as Sql;
}, 30000);
beforeEach(async () => {
  await pg.exec("truncate shorts_mvp.shorts_guide_events");
  vi.mocked(getDb).mockReturnValue(db);
});
afterAll(async () => {
  await pg.close();
});
describe("anonymous guide collection with a real isolated PostgreSQL engine", () => {
  it("accepts events through the route and actually persists them", async () => {
    const response = await POST(
      request([
        event(1, { name: "quiz_started", question: undefined }),
        event(2),
        event(3, {
          name: "answer_selected",
          answer: "products",
          answers: { category: "products" },
        }),
      ]),
    );
    expect(response.status).toBe(200);
    const rows = await pg.query(
      "select event_name,answer from shorts_mvp.shorts_guide_events order by sequence",
    );
    expect(rows.rows).toEqual([
      { event_name: "quiz_started", answer: null },
      { event_name: "question_viewed", answer: null },
      { event_name: "answer_selected", answer: "products" },
    ]);
  });
  it("deduplicates retries and repeated starts, keeping distinct answer changes", async () => {
    const batch = [
      event(1, { name: "quiz_started" }),
      event(2, {
        name: "answer_selected",
        answer: "products",
        answers: { category: "products" },
      }),
      event(3, {
        name: "answer_selected",
        answer: "knowledge",
        answers: { category: "knowledge" },
      }),
    ];
    await saveGuideEvents(db, batch, "production");
    await saveGuideEvents(db, batch, "production");
    await saveGuideEvents(
      db,
      [event(4, { name: "quiz_started" })],
      "production",
    );
    const result = (
      await pg.query<{ selection_count: number; latest_answers: unknown }>(
        "select * from shorts_mvp.shorts_guide_survey_summary",
      )
    ).rows[0];
    expect(Number(result.selection_count)).toBe(2);
    expect(result.latest_answers).toEqual({ category: "knowledge" });
    expect(
      (await pg.query("select * from shorts_mvp.shorts_guide_events")).rows,
    ).toHaveLength(3);
  });
  it("late delivery does not overwrite newer answers or the latest completion", async () => {
    await saveGuideEvents(
      db,
      [
        event(20, {
          name: "quiz_completed",
          answers: { ...complete, time: "long" },
        }),
        event(18, { name: "quiz_completed", answers: complete }),
        event(9, { answers: { category: "food" } }),
      ],
      "production",
    );
    const row = (
      await pg.query<{ latest_answers: unknown; completed_answers: unknown }>(
        "select * from shorts_mvp.shorts_guide_survey_summary",
      )
    ).rows[0];
    expect(row.latest_answers).toEqual({ ...complete, time: "long" });
    expect(row.completed_answers).toEqual({ ...complete, time: "long" });
  });
  it("records the last question for incomplete attempts and separates test traffic", async () => {
    await saveGuideEvents(
      db,
      [
        event(1, { name: "quiz_started" }),
        event(2, { question: "goal", answers: { category: "products" } }),
      ],
      "development",
    );
    const row = (
      await pg.query("select * from shorts_mvp.shorts_guide_survey_summary")
    ).rows[0];
    expect(row).toMatchObject({
      environment: "development",
      last_question: "goal",
      completed_at: null,
    });
  });
  it("rejects invented choices, free text, incomplete completion, and excessive batches", async () => {
    for (const batch of [
      [event(1, { answers: { category: "anything" } })],
      [event(1, { name: "quiz_completed" })],
      [{ ...event(1), email: "private@example.com" }],
      [
        event(1, {
          name: "answer_selected",
          answer: "gaming",
          answers: { category: "food" },
        }),
      ],
      Array.from({ length: 21 }, (_, i) => event(i + 1)),
    ]) {
      expect(batchSchema.safeParse({ events: batch }).success).toBe(false);
      expect((await POST(request(batch))).status).toBe(400);
    }
    expect(
      (await pg.query("select * from shorts_mvp.shorts_guide_events")).rows,
    ).toHaveLength(0);
  });
  it("rejects other origins, malformed JSON, and oversized payloads before writing", async () => {
    expect(
      (await POST(request([event(1)], "https://other.example"))).status,
    ).toBe(403);
    expect((await POST(request([], undefined, "{"))).status).toBe(400);
    expect((await POST(request([], undefined, " ".repeat(33000)))).status).toBe(
      413,
    );
  });
  it("returns unavailable rather than pretending to save when DB is missing", async () => {
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error("connection secret");
    });
    const response = await POST(request([event(1)]));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
  it("denies both anonymous and authenticated direct table and view access", async () => {
    for (const role of ["anon", "authenticated"]) {
      await pg.exec(`set role ${role}`);
      await expect(
        pg.query("select * from shorts_mvp.shorts_guide_events"),
      ).rejects.toThrow();
      await expect(
        pg.query("select * from shorts_mvp.shorts_guide_survey_summary"),
      ).rejects.toThrow();
      await pg.exec("reset role");
    }
  });
});
