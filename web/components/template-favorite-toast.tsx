export function TemplateFavoriteToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-1/2 z-[100] w-[min(90vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/15 bg-[#17171a]/95 px-7 py-6 text-center shadow-[0_24px_90px_rgba(0,0,0,.58)] backdrop-blur-xl"
    >
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#ff715e]/15 text-[#ff8c7c]" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M9.55 17.65 4.9 13l1.4-1.4 3.25 3.25 8.15-8.15L19.1 8.1l-9.55 9.55Z" /></svg>
      </span>
      <p className="mt-4 text-lg font-extrabold tracking-[-.02em] text-white sm:text-xl">{message}</p>
    </div>
  );
}
