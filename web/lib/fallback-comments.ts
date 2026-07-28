import fallbackComments from "./fallback-comments.json";

export const FALLBACK_COMMENT_TEXTS: readonly string[] = Object.freeze([
  ...fallbackComments,
]);

export function selectRandomFallbackCommentTexts(
  count: number,
  excludedTexts: Iterable<string> = [],
  random: () => number = Math.random,
) {
  const requestedCount = Math.max(0, Math.floor(count));
  const excluded = new Set(excludedTexts);
  let candidates = FALLBACK_COMMENT_TEXTS.filter((text) => !excluded.has(text));
  if (candidates.length === 0 && requestedCount > 0) {
    candidates = [...FALLBACK_COMMENT_TEXTS];
  }

  const selected: string[] = [];
  while (selected.length < Math.min(requestedCount, candidates.length)) {
    const randomIndex = Math.min(
      candidates.length - 1,
      Math.max(0, Math.floor(random() * candidates.length)),
    );
    selected.push(candidates.splice(randomIndex, 1)[0]);
  }
  return selected;
}
