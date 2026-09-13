import Link from "next/link";

export default function BlogNotFound() {
  return <main id="blog-main" className="mx-auto max-w-3xl px-6 py-32 text-white"><h1 className="text-3xl font-bold">글을 찾을 수 없어요</h1><p className="mt-5 text-neutral-300">주소를 다시 확인하거나 블로그에서 다른 글을 찾아보세요.</p><Link className="mt-8 inline-block text-[#ffb4a8] underline" href="/blog">이지컷 블로그로 돌아가기</Link></main>;
}
