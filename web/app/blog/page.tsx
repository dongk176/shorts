import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { StructuredData } from "@/components/structured-data";
import { BLOG_CATEGORIES, BLOG_DESCRIPTION, BLOG_TITLE, blogBreadcrumbData, blogPosts, blogPost } from "@/lib/blog";
import { createPageMetadata, SITE_URL } from "@/lib/seo";
import { BlogCatalog } from "./blog-catalog";
import styles from "./blog.module.css";

export const metadata: Metadata = createPageMetadata({ title: "이지컷 블로그 | AI 쇼츠 사용법과 크리에이터 제작 노트", description: BLOG_DESCRIPTION, path: "/blog" });

export default function BlogPage() {
  const featured = blogPost("vlog-to-shorts")!;
  return (
    <main id="blog-main" className={styles.main}>
      <StructuredData data={{ "@context": "https://schema.org", "@type": "Blog", "@id": `${SITE_URL}/blog#blog`, url: `${SITE_URL}/blog`, name: BLOG_TITLE, description: BLOG_DESCRIPTION, inLanguage: "ko-KR", publisher: { "@id": `${SITE_URL}/#organization` }, blogPost: blogPosts.map((post) => ({ "@type": "BlogPosting", headline: post.title, url: `${SITE_URL}/blog/${post.slug}` })) }} />
      <StructuredData data={blogBreadcrumbData()} />
      <section className={styles.hero} aria-labelledby="blog-title">
        <div className={styles.heroCopy}><p className={styles.eyebrow}>EASYCUT · CREATOR NOTES</p><h1 id="blog-title">이지컷 블로그</h1><p className={styles.heroLead}>긴 영상에서,<br /><em>다음 쇼츠의 가능성을.</em></p><p className={styles.heroDescription}>시작은 가볍게, 제작은 꾸준하게.<br />AI 편집 사용법부터 원본 활용 팁까지,<br className={styles.desktopBreak} /> 다음 한 편에 바로 써먹을 이야기를 모았어요.</p><a href="#posts" className={styles.heroLink}>나에게 필요한 글 찾기 <span aria-hidden="true">↓</span></a><p className={styles.heroNote}>이지컷 운영팀이 직접 확인하고 기록합니다.</p></div>
        <Link href={`/blog/${featured.slug}`} className={styles.featured} prefetch={false}><div className={styles.featuredImage}><Image src={featured.cover.src} alt={featured.cover.alt} width={featured.cover.width} height={featured.cover.height} priority sizes="(max-width: 767px) 100vw, 45vw" /></div><div className={styles.featuredBody}><span className={styles.eyebrow}>이번에 읽어볼 글</span><h2>{featured.title}</h2><p>찍어둔 일상에서, 짧게 남길 이야기 하나.</p><span className={styles.featuredArrow} aria-hidden="true">↗</span></div></Link>
      </section>
      <BlogCatalog categories={BLOG_CATEGORIES} posts={blogPosts.map(({ slug, title, description, category, cover, readingMinutes }) => ({ slug, title, description, category, cover, readingMinutes }))} />
      <section id="editorial" className={styles.editorial} aria-labelledby="editorial-title"><p className={styles.eyebrow}>HOW WE WRITE</p><h2 id="editorial-title">직접 써보고, 근거를 남깁니다.</h2><div><p>이 블로그는 이지컷을 운영하는 아티룸의 공식 콘텐츠입니다. 실제 서비스 화면과 운영팀의 제작 기록을 바탕으로 사용법을 설명해요. AI로 만든 이미지와 연출 예시는 캡션에 구분해 두었습니다.</p><p>비교글에는 확인 날짜와 출처, 결제 기간과 제공량 같은 비교 조건을 함께 적어요. 기능이나 가격이 달라졌거나 수정할 내용을 발견했다면 <Link href="/support">운영팀에 알려주세요.</Link></p></div></section>
    </main>
  );
}
