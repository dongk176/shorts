import { describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  getAllProjects,
  getAuthenticatedProjectPageAccess,
  getProjectByNumber,
  getPublicExampleJobs,
  getPublicExampleProjectByNumber,
  getRecentJobs,
} from "./data";

const session = {
  id: "session-a",
  selectedPlanCode: "plus",
  userId: "user-a",
  user: null,
};

function queryRecorder() {
  const queries: string[] = [];
  const query = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.reduce(
      (text, part, index) => `${text}${part}${index < values.length ? `$${index + 1}` : ""}`,
      "",
    ).replace(/\s+/g, " ").trim());
    return Promise.resolve([]);
  });
  return { db: query as unknown as Sql, queries };
}

const readers: Array<[string, (db: Sql) => Promise<unknown>]> = [
  ["recent project list", (db) => getRecentJobs(db, session)],
  ["single recent project poll", (db) => getRecentJobs(db, session, "job-a")],
  ["all projects", (db) => getAllProjects(db, session)],
  ["project API lookup", (db) => getProjectByNumber(db, session, 12)],
  ["project page authorization", (db) => getAuthenticatedProjectPageAccess(db, "auth-a", 12)],
  ["public examples", (db) => getPublicExampleJobs(db)],
  ["single public example", (db) => getPublicExampleProjectByNumber(db, 12)],
];

describe("soft-deleted project visibility", () => {
  it.each(readers)("excludes user-deleted rows from %s", async (_, load) => {
    const { db, queries } = queryRecorder();

    await load(db);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("user_deleted_at is null");
  });
});
