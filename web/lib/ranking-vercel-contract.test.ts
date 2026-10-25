import { expect, it } from "vitest";
import { rankingVercelResult } from "./ranking-vercel-contract";
const id = "bb067942-b3ac-4a46-a9fc-3bf260a209cd";
it("rejects another operation output and oversized duration", () => {
  expect(() =>
    rankingVercelResult(id, id, null, {
      duration: 10,
      outputKey: "outputs/another.mp4",
    }),
  ).toThrow();
  expect(() =>
    rankingVercelResult(id, id, null, {
      duration: 181,
      outputKey: `outputs/ranking/${id}/${id}.mp4`,
    }),
  ).toThrow();
  expect(
    rankingVercelResult(id, id, null, {
      duration: 10,
      outputKey: `outputs/ranking/${id}/${id}.mp4`,
    }),
  ).toEqual({ duration: 10, outputKey: `outputs/ranking/${id}/${id}.mp4` });
});
it("requires a playable source belonging to the admitted source", () => {
  const source = {
    id,
    duration: 10,
    width: 720,
    height: 1280,
    hasAudio: true,
    previewReady: true,
    durationKnown: true,
  };
  expect(rankingVercelResult(id, id, id, { source })).toEqual({ source });
  expect(() =>
    rankingVercelResult(id, id, id, {
      source: { ...source, id: "f32fe236-a402-4d7a-b1bf-9de9ea5bb5a1" },
    }),
  ).toThrow();
  expect(() =>
    rankingVercelResult(id, id, id, {
      source: { ...source, duration: Infinity },
    }),
  ).toThrow();
});

it("only exposes known progress stages and finite measured percentages", async () => {
  const {rankingVercelProgress} = await import("./ranking-vercel-contract");
  expect(rankingVercelProgress({stage:"downloading",percent:42.5,secret:"hidden"})).toEqual({stage:"downloading",percent:42.5});
  expect(rankingVercelProgress({stage:"downloading",percent:NaN})).toEqual({stage:"downloading"});
  expect(rankingVercelProgress({stage:"downloading",percent:140})).toEqual({stage:"downloading",percent:100});
  expect(rankingVercelProgress({stage:"converting",percent:99})).toEqual({stage:"converting"});
  expect(rankingVercelProgress({stage:"arbitrary"})).toBeUndefined();
  expect(rankingVercelProgress(null)).toBeUndefined();
});
