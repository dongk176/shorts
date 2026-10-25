import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizePopularQuery } from "./popular-text-search";
import { popularVideoCategories, popularDiscoveryPeriods } from "./youtube-popular";

export const rankingSearchSchema = z.object({
  q: z.string().max(300).transform(normalizePopularQuery).refine(q => [...q].length >= 2 && [...q].length <= 100),
  category: z.enum(popularVideoCategories).default("all"),
  language: z.enum(["all", "ko", "ja", "en"]).default("all"),
  period: z.enum(popularDiscoveryPeriods).default("all"),
  reusable: z.boolean().default(false),
  cursor: z.string().max(180).optional(),
}).strict();
export type RankingSearchInput = z.infer<typeof rankingSearchSchema>;
export const SEARCH_PAGE_SIZE = 48;
export const SEARCH_RESULT_LIMIT = 240;
function fingerprint(input: RankingSearchInput) {
  return createHash("sha256").update(JSON.stringify([input.q,input.category,input.language,input.period,input.reusable])).digest("hex").slice(0,24);
}
export function rankingSearchOffset(input: RankingSearchInput) {
  if (!input.cursor) return 0;
  const match = /^([0-9a-f]{24}):(\d{1,3})$/.exec(input.cursor);
  const offset = Number(match?.[2]);
  if (!match || match[1] !== fingerprint(input) || offset <= 0 || offset % SEARCH_PAGE_SIZE !== 0 || offset >= SEARCH_RESULT_LIMIT) throw new Error("InvalidSearchCursor");
  return offset;
}
export function rankingSearchCursor(input: RankingSearchInput, offset: number) { return `${fingerprint(input)}:${offset}`; }
