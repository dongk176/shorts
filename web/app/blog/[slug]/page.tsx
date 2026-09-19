import { createLocalizedPageMetadata } from "@/lib/i18n/metadata";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "@/lib/i18n/navigation";
import { notFound } from "next/navigation";
import { StructuredData } from "@/components/structured-data";
import { blogArticleData, blogBreadcrumbData, blogDate, blogPath, blogPost, publishedBlogPosts } from "@/lib/blog";
import { absoluteUrl } from "@/lib/seo";
import styles from "../blog.module.css";

type Props = { params: Promise<{ slug: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = blogPost((await params).slug);
  if (!post) return { title: "글을 찾을 수 없어요", robots: { index: false, follow: true } };
  const base = await createLocalizedPageMetadata({ title: `${post.title} | 이지컷 블로그`, description: post.description, path: blogPath(post.slug), type: "article" });
  return { ...base, authors: [{ name: "이지컷 운영팀", url: absoluteUrl("/blog#editorial") }], keywords: post.tags,
    openGraph: { ...base.openGraph, type: "article", publishedTime: post.publishedAt, modifiedTime: post.updatedAt, authors: [absoluteUrl("/blog#editorial")], images: [{ url: absoluteUrl(post.cover.src), width: post.cover.width, height: post.cover.height, alt: post.title }] },
    twitter: { ...base.twitter, images: [absoluteUrl(post.cover.src)] },
  };
}

export default async function BlogArticlePage({ params }: Props) {
  const post = blogPost((await params).slug);
  if (!post) notFound();
  const related = publishedBlogPosts().filter((item) => item.slug !== post.slug).sort((a,b) => Number(b.category === post.category) - Number(a.category === post.category)).slice(0,3);
  return (
    <main id="blog-main" className={styles.articleMain}>
      <StructuredData data={blogArticleData(post)} /><StructuredData data={blogBreadcrumbData(post)} />
      <nav className={styles.breadcrumb} aria-label="현재 위치"><Link href="/blog">이지컷 블로그</Link><span aria-hidden="true">/</span><span>{post.category}</span></nav>
      <article>
        <header className={styles.articleHeader}><p className={styles.eyebrow}>{post.category}</p><h1>{post.title}</h1><p className={styles.dek}>{post.description}</p><div className={styles.byline}><Link href="/blog#editorial">이지컷 운영팀</Link><span>발행 <time dateTime={post.publishedAt}>{blogDate(post.publishedAt)}</time></span><span>{post.readingMinutes}분 읽기</span></div></header>
        <div className={styles.articleLayout}>
          <div className={styles.articleContent}>
            {post.revisionNote ? <p className={styles.revision}>{post.revisionNote}</p> : null}
            {post.blocks.map((block, index) => block.type === "image" ? <figure className={styles.figure} key={index}><a href={block.src} target="_blank" rel="noopener noreferrer" aria-label={`${block.alt} 원본 크게 보기`}><Image src={block.src} alt={block.alt} width={block.width} height={block.height} sizes="(max-width: 767px) 100vw, 760px" priority={index === 0} className={block.height > block.width * 1.3 ? styles.portraitImage : undefined} /></a><figcaption>{block.caption}</figcaption></figure> : <div key={index} className={styles.prose} dangerouslySetInnerHTML={{ __html: block.html }} />)}
            <section className={styles.sources} aria-labelledby="article-sources"><h2 id="article-sources">확인한 자료와 출처</h2><p>정보 확인일: <time dateTime={post.verifiedAt}>{blogDate(post.verifiedAt)}</time><br />기능·가격·이용 조건은 변경될 수 있어요. 현재 제공 조건은 각 서비스에서 확인해 주세요.</p><ul>{post.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label} <span aria-hidden="true">↗</span></a></li>)}</ul><p>작성·편집: <Link href="/blog#editorial">이지컷 운영팀</Link> · <Link href="/support">수정 제안·문의</Link></p></section>
            <div className={styles.tags} aria-label="글의 키워드">{post.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
          </div>
          <aside className={styles.toc}><div><p>이 글에서 살펴볼 내용</p><nav aria-label="글 목차"><ol>{post.toc.map((heading) => <li key={heading.id}><a href={`#${heading.id}`}>{heading.title}</a></li>)}</ol></nav><Link className={styles.tocHome} href="/blog">← 모든 글 보기</Link></div></aside>
        </div>
      </article>
      <section className={styles.related} aria-labelledby="related-title"><div className={styles.catalogHeading}><h2 id="related-title">이어서 읽어보세요</h2><Link href="/blog">모든 글 보기 ↗</Link></div><div className={styles.relatedGrid}>{related.map((item) => <Link key={item.slug} href={blogPath(item.slug)} prefetch={false}><Image src={item.cover.src} alt={item.cover.alt} width={item.cover.width} height={item.cover.height} sizes="(max-width: 767px) 100vw, 30vw" /><span>{item.category}</span><h3>{item.title}</h3></Link>)}</div></section>
    </main>
  );
}
