export type RankingExample = {
  id: string;
  category: string;
  title: string;
  channel: string;
  views: number;
  publishedAt: string;
  duration: number;
  language: string;
  url: string;
  checkedAt?: string;
};

export const rankingExampleLanguages = { ko: "한국어", en: "영어", ja: "일본어" } as const;

export function sortRankingExamples(items: RankingExample[], locale: string, sort = "views") {
  const language = rankingExampleLanguages[locale.split("-")[0] as keyof typeof rankingExampleLanguages];
  return [...items].sort((a, b) => {
    if (language) {
      const priority = Number(b.language === language) - Number(a.language === language);
      if (priority) return priority;
    }
    return (sort === "recent" ? b.publishedAt.localeCompare(a.publishedAt) : b.views - a.views)
      || b.views - a.views || a.id.localeCompare(b.id);
  });
}
