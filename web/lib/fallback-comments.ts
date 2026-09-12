import fallbackComments from "./fallback-comments.json";
import { commentDuplicateKey, contentLanguages } from "./content-language";
import type { OutputLanguage } from "./contracts";

export const FALLBACK_COMMENT_TEXTS: readonly string[] = Object.freeze([
  ...fallbackComments,
]);

export function selectRandomFallbackCommentTexts(
  count: number,
  excludedTexts: Iterable<string> = [],
  random: () => number = Math.random,
  outputLanguage: OutputLanguage = "ko",
) {
  const requestedCount = Math.max(0, Math.floor(count));
  const catalog = outputLanguage === "ko"
    ? FALLBACK_COMMENT_TEXTS : contentLanguages[outputLanguage].comments;
  const excluded = new Set(Array.from(excludedTexts, commentDuplicateKey));
  let candidates = catalog.filter((text) => !excluded.has(commentDuplicateKey(text)));
  if (candidates.length === 0 && requestedCount > 0) {
    candidates = [...catalog];
  }

  const selected: string[] = [];
  const selectedCount = Math.min(requestedCount, candidates.length);
  while (selected.length < selectedCount) {
    const randomIndex = Math.min(
      candidates.length - 1,
      Math.max(0, Math.floor(random() * candidates.length)),
    );
    selected.push(candidates.splice(randomIndex, 1)[0]);
  }
  return selected;
}
