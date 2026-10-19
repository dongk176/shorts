import { describe, expect, it } from "vitest";
import type { MvpState, VideoJob } from "./contracts";
import { mergeHomeCore, mergeHomeProjects } from "./home-projects-state";
const job = (id: string, time = 1) => ({ id, createdAt: new Date(time).toISOString() } as VideoJob);
const state = (owner = "a", jobs = [job("existing")]) => ({
  user: { id: owner }, recentJobs: jobs, recentJobsLoaded: false,
} as MvpState);
describe("independent home project loading", () => {
  it("keeps visible projects while refreshing the same account's core", () => {
    expect(mergeHomeCore(state(), state("a", [])).recentJobs).toEqual([job("existing")]);
  });
  it("never carries another account's projects into the new core", () => {
    expect(mergeHomeCore(state(), state("b", [])).recentJobs).toEqual([]);
  });
  it("ignores a late project response for a previous account", () => {
    const current = state("b");
    expect(mergeHomeProjects(current, { userId: "a", recentJobs: [job("private")] }, 10)).toBe(current);
  });
  it("preserves a project submitted after the list request began", () => {
    const merged = mergeHomeProjects(state("a", [job("new", 20), job("old", 1)]), {
      userId: "a", recentJobs: [job("server", 1)],
    }, 10);
    expect(merged?.recentJobs.map(j => j.id)).toEqual(["new", "server"]);
    expect(merged?.recentJobsLoaded).toBe(true);
  });
  it("does not duplicate a newly submitted project already returned by the server", () => {
    expect(mergeHomeProjects(state("a", [job("new", 20)]), {
      userId: "a", recentJobs: [job("new", 20)],
    }, 10)?.recentJobs).toHaveLength(1);
  });
});
