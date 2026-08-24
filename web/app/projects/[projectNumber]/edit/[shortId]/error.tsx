"use client";

import Link from "next/link";

export default function ShortEditorError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="editor-page grid place-items-center p-6 text-center">
      <div className="max-w-md rounded-2xl border border-red-400/20 bg-[#202426] p-7 shadow-2xl">
        <h1 className="text-xl font-black text-white">편집 화면을 다시 불러와 주세요.</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-300">
          템플릿 미리보기를 표시하는 중 문제가 발생했습니다. 편집 내용은 아직 영상에 적용되지 않았습니다.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-white px-5 py-3 text-sm font-black text-black"
          >
            편집기 다시 열기
          </button>
          <Link
            href="/projects"
            className="rounded-xl border border-white/15 px-5 py-3 text-sm font-bold text-white"
          >
            프로젝트 목록
          </Link>
        </div>
      </div>
    </main>
  );
}
