const labels: Record<string, string> = { good: "좋아요", okay: "보통이에요", poor: "아쉬워요" };
export function AdminRankingFeedback({ rows }: { rows: Array<{ operationId: string; name: string | null; rating: string; comment: string; createdAt: string }> }) {
  return <section className="mt-7 rounded-2xl border border-white/10 bg-[#151819] p-5" aria-label="랭킹 쇼츠 피드백">
    <h2 className="text-lg font-bold">랭킹 쇼츠 · 결과물 피드백</h2>
    <p className="mt-1 text-sm text-neutral-400">최근 응답 최대 100건 · 영상별 1회 · 별도 보상 없음</p>
    <div className="my-4 flex flex-wrap gap-3">{Object.entries(labels).map(([key,label]) => <span key={key} className="rounded-lg bg-white/5 px-3 py-2 text-sm">{label} {rows.filter(row => row.rating === key).length}건</span>)}</div>
    {rows.length ? <ul className="divide-y divide-white/10">{rows.map(row => <li key={row.operationId} className="py-4">
      <div className="flex flex-wrap items-center gap-3"><strong>{labels[row.rating] || row.rating}</strong><span className="text-sm text-neutral-400">{row.name || "사용자"}</span><time className="text-xs text-neutral-500">{new Date(row.createdAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</time></div>
      {row.comment && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-neutral-200">{row.comment}</p>}
    </li>)}</ul> : <p className="py-5 text-sm text-neutral-400">아직 접수된 의견이 없습니다.</p>}
  </section>;
}
