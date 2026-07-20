export function BillingResult({ status, error = false }: { status: string; error?: boolean }) {
  return (
    <main className="app-shell grid min-h-screen place-items-center px-5 text-neutral-100">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#191c1e] p-8 text-center shadow-2xl">
        <div className={`mx-auto grid h-12 w-12 place-items-center rounded-full text-xl font-black ${error ? "bg-red-500/15 text-red-200" : "bg-emerald-500/15 text-emerald-200"}`}>{error ? "!" : "✓"}</div>
        <h1 className="mt-5 text-2xl font-black">{error ? "결제를 완료하지 못했습니다" : "결제를 확인하고 있습니다"}</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-400">{status}</p>
        <a href={error ? "/pricing" : "/#workspace"} className="mt-7 flex min-h-12 items-center justify-center rounded-xl bg-[#ff715e] px-5 text-sm font-extrabold text-[#410000]">{error ? "가격 페이지로 돌아가기" : "Easy Cut으로 이동"}</a>
      </section>
    </main>
  );
}
