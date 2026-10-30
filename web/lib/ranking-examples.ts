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

export function sortRankingExamples(items: RankingExample[], locale: string, sort = "views") {
  return [...items].sort((a, b) => {
    if (["ko", "en"].includes(locale.split("-")[0])) {
      const language = locale.split("-")[0] === "ko" ? "한국어" : "영어";
      const priority = Number(b.language === language) - Number(a.language === language);
      if (priority) return priority;
    }
    return (sort === "recent" ? b.publishedAt.localeCompare(a.publishedAt) : b.views - a.views)
      || b.views - a.views || a.id.localeCompare(b.id);
  });
}
