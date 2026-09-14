import { afterEach, describe, expect, it, vi } from "vitest";
import posts from "@/content/blog/posts.json";
import { publishedPosts } from "./blog-publication";

vi.mock("server-only", () => ({}));
import { blogPost, publishedBlogPosts } from "./blog";

afterEach(() => vi.useRealTimers());

describe("scheduled official blog publication", () => {
  it("opens a Korean-time slot at its exact instant, without mutating the source", () => {
    const values = [
      { slug: "later", publishedAt: "2026-09-15T10:00:00+09:00" },
      { slug: "first", publishedAt: "2026-09-15T09:00:00+09:00" },
      { slug: "invalid", publishedAt: "not-a-date" },
    ];
    expect(publishedPosts(values, Date.parse("2026-09-14T23:59:59.999Z"))).toEqual([]);
    expect(publishedPosts(values, Date.parse("2026-09-15T00:00:00Z")).map((p) => p.slug)).toEqual(["first"]);
    expect(publishedPosts(values, Date.parse("2026-09-15T01:00:00Z")).map((p) => p.slug)).toEqual(["later", "first"]);
    expect(values.map((p) => p.slug)).toEqual(["later", "first", "invalid"]);
  });

  it("keeps future articles out of both the catalog and direct lookup, then opens without reimport", () => {
    vi.useFakeTimers();
    const next = posts.find((p) => p.slug === "creator-notes-099")!;
    vi.setSystemTime(Date.parse(next.publishedAt) - 1);
    expect(blogPost(next.slug)).toBeUndefined();
    expect(publishedBlogPosts().some((p) => p.slug === next.slug)).toBe(false);
    vi.setSystemTime(Date.parse(next.publishedAt));
    expect(blogPost(next.slug)?.title).toBe(next.title);
    expect(publishedBlogPosts().some((p) => p.slug === next.slug)).toBe(true);
  });

  it("preserves the original collection and imports only the 99 confirmed Naver posts", () => {
    expect(posts).toHaveLength(131);
    expect(new Set(posts.map((p) => p.slug)).size).toBe(131);
    expect(new Set(posts.map((p) => p.title)).size).toBe(131);
    expect(posts.filter((p) => p.slug.startsWith("creator-notes-"))).toHaveLength(99);
    expect(publishedBlogPosts(Date.parse("2026-09-14T00:00:00+09:00"))).toHaveLength(32);
    expect(publishedBlogPosts(Date.parse("2026-09-21T00:00:00+09:00"))).toHaveLength(131);
    expect(posts.some((p) => p.slug === "creator-notes-100")).toBe(false);
  });
});
