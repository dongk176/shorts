import type { Sql, TransactionSql } from "postgres";

export function normalizePopularQuery(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

const aliases = [
  ["ai", "인공지능"],
  ["chatgpt", "챗지피티", "챗gpt"],
  ["일론머스크", "일론 머스크", "elon musk"],
] as const;

/** Match multi-word aliases before splitting, without expanding substrings (e.g. 'ai' in 'train'). */
export function popularQueryGroups(query: string): string[][] {
  let remaining = normalizePopularQuery(query);
  const groups: string[][] = [];
  while (remaining) {
    const group = aliases.find(values => values.some(value => remaining === value || remaining.startsWith(`${value} `)));
    if (group) {
      const matched = [...group].sort((a, b) => b.length - a.length)
        .find(value => remaining === value || remaining.startsWith(`${value} `))!;
      groups.push([...group]);
      remaining = remaining.slice(matched.length).trimStart();
    } else {
      const [word] = remaining.split(" ");
      groups.push([word]);
      remaining = remaining.slice(word.length).trimStart();
    }
  }
  return groups;
}

export const escapeSearchLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** Expressions intentionally match the GIN indexes in the search migration. */
export function popularSearchSql(db: Sql | TransactionSql, query: string) {
  const title = db`shorts_mvp.popular_search_normalize(c.metadata->>'title')`;
  const channel = db`shorts_mvp.popular_search_normalize(c.metadata->>'channelName')`;
  const compactTitle = db`replace(${title},' ','')`;
  const compactChannel = db`replace(${channel},' ','')`;
  const text = normalizePopularQuery(query).replace(/ /g, "");
  const phrase = `%${escapeSearchLike(text)}%`;
  const exactPhrase = db`(${compactTitle}=${text} or ${compactChannel}=${text})`;
  const containsPhrase = db`(${compactTitle} like ${phrase} or ${compactChannel} like ${phrase})`;
  const groups = popularQueryGroups(query);
  const checks = groups.map(variants => {
    const exact = variants.map(value => {
      const pattern = `%${escapeSearchLike(value.replace(/ /g, ""))}%`;
      return db`(${compactTitle} like ${pattern} or ${compactChannel} like ${pattern})`;
    }).reduce((a, b) => db`(${a} or ${b})`);
    // Fully qualified wrappers resolve pg_trgm wherever the installed extension lives.
    const fuzzy = variants.filter(value => [...value.replace(/ /g, "")].length >= 3 && /^[\p{L}\p{N} ]+$/u.test(value)).map(value =>
      db`(shorts_mvp.popular_search_word_match(${value},${title}) or shorts_mvp.popular_search_word_match(${value},${channel}))`,
    );
    const match = fuzzy.reduce((a, b) => db`(${a} or ${b})`, exact);
    const scores = variants.map(value => db`greatest(shorts_mvp.popular_search_word_score(${value},${title}),shorts_mvp.popular_search_word_score(${value},${channel}))`);
    const score = scores.reduce((a, b) => db`greatest(${a},${b})`);
    return { exact, match, score };
  });
  const allExact = checks.map(check => check.exact).reduce((a, b) => db`(${a} and ${b})`);
  const allMatch = checks.map(check => check.match).reduce((a, b) => db`(${a} and ${b})`);
  return {
    match: db`(${containsPhrase} or ${allMatch})`,
    tier: db`case when ${exactPhrase} then 0 when ${containsPhrase} then 1 when ${allExact} then 2 else 3 end`,
    score: checks.map(check => check.score).reduce((a, b) => db`(${a}+${b})`),
  };
}
