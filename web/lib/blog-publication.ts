type DatedPost = { publishedAt: string };

export function publishedPosts<T extends DatedPost>(posts: readonly T[], now = Date.now()): T[] {
  return posts
    .filter((post) => Date.parse(post.publishedAt) <= now)
    .slice()
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}
