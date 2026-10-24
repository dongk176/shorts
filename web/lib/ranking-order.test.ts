import { describe, expect, it } from "vitest";
import {
  moveRankingRank,
  rankingOrderForCount,
  shuffleRankingOrder,
} from "./ranking-order";
import { rankingRenderSchema } from "./ranking-shorts";

describe("ranking playback order", () => {
  it("preserves manual order when shrinking or extending the rank count", () => {
    expect(rankingOrderForCount([3, 5, 1, 4, 2], 3)).toEqual([3, 1, 2]);
    expect(rankingOrderForCount([3, 1, 2], 5)).toEqual([3, 1, 2, 4, 5]);
    expect(rankingOrderForCount([3, 3, 0, 8, 1], 3)).toEqual([3, 1, 2]);
  });
  it("moves a rank in either direction without dropping or duplicating entries", () => {
    const order = [5, 4, 3, 2, 1];
    expect(moveRankingRank(order, 2, 5)).toEqual([2, 5, 4, 3, 1]);
    expect(moveRankingRank(order, 5, 1)).toEqual([4, 3, 2, 1, 5]);
    expect(moveRankingRank(order, 7, 1)).toEqual(order);
    expect(order).toEqual([5, 4, 3, 2, 1]);
  });
  it("shuffles once into a complete permutation without mutating the selection", () => {
    const order = [1, 2, 3, 4, 5];
    const shuffled = shuffleRankingOrder(order, () => 0);
    expect(shuffled).toEqual([2, 3, 4, 5, 1]);
    expect([...shuffled].sort()).toEqual(order);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });
  it("requires every populated rank exactly once while allowing empty ranks to be skipped", () => {
    const spec = {
      title: "랭킹",
      descending: true,
      rankCount: 5,
      clips: [1, 3, 5].map((rank) => ({
        rank,
        sourceId: "193a3540-3366-4526-94be-030a34293344",
        label: "장면",
        start: 0,
        end: 2,
      })),
    };
    expect(
      rankingRenderSchema.parse({ ...spec, playbackOrder: [3, 1, 5] })
        .playbackOrder,
    ).toEqual([3, 1, 5]);
    for (const playbackOrder of [
      [],
      [1, 3],
      [3, 3, 1],
      [1, 3, 2],
      [1, 3, 5, 2],
    ]) {
      expect(
        rankingRenderSchema.safeParse({ ...spec, playbackOrder }).success,
      ).toBe(false);
    }
    expect(rankingRenderSchema.safeParse(spec).success).toBe(true);
  });
});
