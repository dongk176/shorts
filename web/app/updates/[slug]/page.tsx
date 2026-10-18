import { updatesMetadata } from "../metadata";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publishedUpdates } from "@/lib/update-store";
import { UpdateArticleView } from "../article-view";
import { getRequestLocale } from "@/lib/i18n/server";
import { updateCopy } from "../copy";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
 const slug = (await params).slug;
 const locale = await getRequestLocale();
 const post = (await publishedUpdates(locale)).find(p => p.slug === slug);
 return post ? updatesMetadata(post, 1, locale) : { title: updateCopy(locale).notFound, robots: { index: false, follow: true } };
}
export default async function UpdateArticle({ params }: Props) {
 const locale = await getRequestLocale();
 const slug = (await params).slug; const updates = await publishedUpdates(locale); const post = updates.find(p => p.slug === slug);
 if (!post) notFound();
 return <main><UpdateArticleView post={post} locale={locale} related={updates.filter(p => p.slug !== slug && p.topic === post.topic).slice(0, 2)}/></main>;
}
