"use client";
export default function Error({reset}: {reset:()=>void}) {
  return <main className="min-h-screen bg-[#080a0f] p-10 text-neutral-200"><div role="alert"><h1 className="text-xl font-bold">해외 데이터를 불러오지 못했습니다</h1><p className="my-4 text-sm text-neutral-400">연결 상태를 확인한 뒤 다시 시도해 주세요.</p><button type="button" onClick={reset} className="rounded-lg bg-violet-600 px-5 py-3 text-sm font-bold">다시 시도</button></div></main>;
}
