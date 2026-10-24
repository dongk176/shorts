import { describe, expect, it, vi } from "vitest";
import { resolveRankingRender } from "./ranking-resolve-render";
import { defaultRankingStyle } from "./ranking-templates";
import type { RankingRender, RankingSource } from "./ranking-shorts";
const spec: RankingRender = {
  title: "제목", subtitle: "둘째 줄", style: defaultRankingStyle, descending: false,
  rankCount: 5, playbackOrder: [3, 1], clips: [
    {rank: 1, sourceId: "local-1", label: "첫 영상", start: 3.25, end: 7.5},
    {rank: 3, sourceId: "local-3", label: "다음 영상", start: 1, end: 4},
  ],
};
const source = (id: string, duration = 21): RankingSource => ({
  id, duration, durationKnown: true, width: 720, height: 1280, hasAudio: true,
});
describe("deferred ranking source registration", () => {
  it("resolves sequentially and preserves trim, blank ranks, order and design", async () => {
    const resolve = vi.fn(async (clip: RankingRender["clips"][number]) => source(`server-${clip.rank}`));
    const result = await resolveRankingRender(spec, resolve);
    expect(resolve.mock.calls.map(([clip]) => clip.rank)).toEqual([1, 3]);
    expect(result).toEqual({...spec, clips: spec.clips.map(clip => ({...clip, sourceId: `server-${clip.rank}`}))});
    expect(spec.clips[0].sourceId).toBe("local-1");
  });
  it("fails before submission if server duration contradicts a selected range", async () => {
    const resolve = vi.fn(async () => source("server", 6));
    await expect(resolveRankingRender(spec, resolve)).rejects.toThrow("1위 선택 구간");
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it.each([NaN, Infinity, 0, 1201])("rejects invalid/over-limit server length %s", async duration => {
    await expect(resolveRankingRender(spec, async () => source("server", duration))).rejects.toThrow();
  });
  it("requires verified metadata and propagates registration failures", async () => {
    await expect(resolveRankingRender(spec, async () => ({...source("server"), durationKnown: false}))).rejects.toThrow("길이");
    await expect(resolveRankingRender(spec, async () => {throw new Error("server rejected");})).rejects.toThrow("server rejected");
  });
});
