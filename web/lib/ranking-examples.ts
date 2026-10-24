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
    if (locale.split("-")[0] === "ko") {
      const priority = Number(b.language === "한국어") - Number(a.language === "한국어");
      if (priority) return priority;
    }
    return (sort === "recent" ? b.publishedAt.localeCompare(a.publishedAt) : b.views - a.views)
      || b.views - a.views || a.id.localeCompare(b.id);
  });
}
