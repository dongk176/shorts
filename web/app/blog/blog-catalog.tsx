"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "@/lib/i18n/navigation";
import type { BlogPost } from "@/lib/blog";
import styles from "./blog.module.css";

type CardPost = Pick<BlogPost, "slug" | "title" | "description" | "category" | "cover" | "readingMinutes">;

export function BlogCatalog({ posts, categories }: { posts: CardPost[]; categories: string[] }) {
  const [category, setCategory] = useState("전체");
  const visible = posts.filter((post) => category === "전체" || post.category === category);
  return (
    <section id="posts" className={styles.catalog} aria-labelledby="all-posts-title">
      <div className={styles.catalogHeading}><h2 id="all-posts-title">다음 한 편을 위한 힌트</h2><p aria-live="polite">{visible.length}편의 글</p></div>
      <div className={styles.filters} aria-label="글 주제 선택">{categories.map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <div className={styles.grid}>
        {posts.map((post) => (
          <article key={post.slug} className={styles.card} hidden={category !== "전체" && post.category !== category}>
            <Link href={`/blog/${post.slug}`} prefetch={false}>
              <div className={styles.cardImage}><Image src={post.cover.src} alt={post.cover.alt} width={post.cover.width} height={post.cover.height} sizes="(max-width: 767px) 100vw, (max-width: 1199px) 45vw, 30vw" /></div>
              <div className={styles.cardBody}><div className={styles.cardMeta}><span>{post.category}</span><span>{post.readingMinutes}분 읽기</span></div><h3>{post.title}</h3><p>{post.description}</p><div className={styles.cardByline}>이지컷 운영팀 <span aria-hidden="true">↗</span></div></div>
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
