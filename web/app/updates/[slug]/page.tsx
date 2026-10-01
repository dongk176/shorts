import { updatesMetadata } from "../metadata";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publishedUpdates } from "@/lib/update-store";
import { UpdateArticleView } from "../article-view";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
 const slug = (await params).slug;
 const post = (await publishedUpdates()).find(p => p.slug === slug);
 return post ? updatesMetadata(post) : { title: "업데이트를 찾을 수 없습니다", robots: { index: false, follow: true } };
}
export default async function UpdateArticle({ params }: Props) {
 const slug = (await params).slug; const updates = await publishedUpdates(); const post = updates.find(p => p.slug === slug);
 if (!post) notFound();
 return <main><UpdateArticleView post={post} related={updates.filter(p => p.slug !== slug && p.topic === post.topic).slice(0, 2)}/></main>;
}
