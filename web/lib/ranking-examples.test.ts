import { expect, it } from "vitest";
import catalog from "@/data/ranking-examples.json";
import { sortRankingExamples } from "./ranking-examples";

it("shows all 100 Korean examples first, with descending views inside both groups", () => {
  const items = sortRankingExamples(catalog.items, "ko");
  expect(items.slice(0, 100).every(item => item.language === "한국어")).toBe(true);
  expect(items.slice(100).every(item => item.language !== "한국어")).toBe(true);
  for (const group of [items.slice(0, 100), items.slice(100)]) {
    expect(group.map(item => item.views)).toEqual(group.map(item => item.views).sort((a,b) => b-a));
  }
  expect(items[0].id).toBe("FjpLxP6tsj0");
});

it("sorts other locales by views across the whole catalog without mutating it", () => {
  const before = catalog.items.map(item => item.id);
  const items = sortRankingExamples(catalog.items, "en");
  expect(items.map(item => item.views)).toEqual(items.map(item => item.views).sort((a,b) => b-a));
  expect(catalog.items.map(item => item.id)).toEqual(before);
});

it("retains Korean priority when the user selects recent order", () => {
  const items = sortRankingExamples(catalog.items, "ko", "recent");
  const korean = items.slice(0, 100);
  expect(korean.every(item => item.language === "한국어")).toBe(true);
  expect(korean.map(item => item.publishedAt)).toEqual(korean.map(item => item.publishedAt).sort().reverse());
});
