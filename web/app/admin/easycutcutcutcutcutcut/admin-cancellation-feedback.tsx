import Link from "next/link";
import { cancellationReasonLabels, type AdminCancellationData } from "@/lib/admin-cancellation-feedback";
const base = "/admin/easycutcutcutcutcutcut";
function date(value:string) {
  return new Intl.DateTimeFormat("ko-KR", {dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Seoul"}).format(new Date(value));
}
function reasonLabel(reason:string) {return cancellationReasonLabels[reason as keyof typeof cancellationReasonLabels] || reason;}
function providerLabel(value:string|null) {return ({toss:"토스",thepayone:"더페이원",paddle:"Paddle"} as Record<string,string>)[value || ""] || value || "미확인";}
export function AdminCancellationFeedbackDashboard({data}:{data:AdminCancellationData}) {
  const {filters}=data;
  const pageLink=(page:number)=>`${base}?${new URLSearchParams({tab:"cancellations",period:filters.days,reason:filters.reason,q:filters.query,page:String(page)})}`;
  return <div className="mt-7 grid gap-6">
    <p className="text-sm leading-6 text-neutral-400">해지 확정 시 남긴 사유와 운영진 메시지입니다. 필터에 맞는 응답을 집계하며, 사유 수집 도입 이전 해지와 결제사 외부 포털에서 직접 해지한 건은 포함되지 않습니다.</p>
    <form action={base} method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-[#171a1b] p-5">
      <input type="hidden" name="tab" value="cancellations" />
      <label className="grid gap-2 text-xs font-bold text-neutral-400">기간<select name="period" defaultValue={filters.days} className="min-h-11 rounded-xl border border-white/15 bg-[#232526] px-3 text-sm text-white"><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option><option value="all">전체 기간</option></select></label>
      <label className="grid gap-2 text-xs font-bold text-neutral-400">해지 사유<select name="reason" defaultValue={filters.reason} className="min-h-11 rounded-xl border border-white/15 bg-[#232526] px-3 text-sm text-white"><option value="all">전체 사유</option>{Object.entries(cancellationReasonLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid min-w-48 flex-1 gap-2 text-xs font-bold text-neutral-400">회원·답변 검색<input type="search" name="q" maxLength={100} defaultValue={filters.query} placeholder="이메일, 이름, 서비스명, 답변 내용" className="min-h-11 rounded-xl border border-white/15 bg-black/20 px-3 text-sm text-white" /></label>
      <button type="submit" className="min-h-11 rounded-xl bg-white px-5 text-sm font-black text-black">조회</button>
      <Link href={`${base}?tab=cancellations`} className="flex min-h-11 items-center px-2 text-sm text-neutral-400 underline">초기화</Link>
    </form>
    <section aria-label="해지 사유 요약" className="grid gap-3 sm:grid-cols-3">
      {[["해지 응답",data.total],["운영진 메시지",data.messages],["다른 서비스 이용 예정",data.alternatives]].map(([label,value])=><article key={label} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5"><p className="text-xs font-bold text-neutral-400">{label}</p><p className="mt-3 text-2xl font-black">{Number(value).toLocaleString("ko-KR")}건</p></article>)}
    </section>
    <section className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
      <h2 className="text-lg font-black">사유별 집계</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.reasons.map(item=><div key={item.reason} className="rounded-xl border border-white/10 p-3"><div className="flex items-center justify-between gap-3 text-sm"><span className="text-neutral-300">{reasonLabel(item.reason)}</span><strong>{item.count}건</strong></div><p className="mt-2 text-xs text-neutral-500">{data.total ? (item.count/data.total*100).toFixed(1) : "0"}%</p></div>)}</div>
    </section>
    <section aria-label="회원별 해지 응답" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-black">회원별 답변</h2><span className="text-sm text-neutral-400">총 {data.total.toLocaleString("ko-KR")}건 · 최신순</span></div>
      {data.rows.length === 0 ? <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-neutral-400">조건에 맞는 해지 응답이 없습니다.</p> : data.rows.map(row=><article key={row.id} className="min-w-0 rounded-2xl border border-white/10 bg-[#171a1b] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-black text-white">{row.displayName || "이름 미등록"}</h3><p className="mt-1 break-all text-sm text-neutral-400">{row.email || "이메일 미등록"}</p></div><span className="rounded-lg border border-[#ff715e]/25 bg-[#ff715e]/10 px-3 py-2 text-xs font-bold text-[#ff9d8f]">{reasonLabel(row.reason)}</span></div>
        <dl className="mt-4 grid gap-x-5 gap-y-2 text-xs text-neutral-400 sm:grid-cols-2"><div><dt className="inline text-neutral-500">해지 요청일 </dt><dd className="inline">{date(row.canceledAt)}</dd></div><div><dt className="inline text-neutral-500">이용 종료일 </dt><dd className="inline">{date(row.accessUntil)}</dd></div><div><dt className="inline text-neutral-500">당시 요금제 </dt><dd className="inline">{row.planName} · {row.billingCycle === "monthly" ? "월간" : row.billingCycle}</dd></div><div><dt className="inline text-neutral-500">결제사 </dt><dd className="inline">{providerLabel(row.provider)}</dd></div></dl>
        {row.reason === "alternative" && <p className="mt-4 break-words text-sm"><span className="text-neutral-500">이용 예정 서비스: </span>{row.alternativeUndecided ? "아직 정하지 않았어요" : row.alternativeService || "미입력"}</p>}
        {row.detail && <div className="mt-4"><h4 className="text-xs font-bold text-neutral-400">추가 해지 사유</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-neutral-200">{row.detail}</p></div>}
        <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-4"><h4 className="text-xs font-bold text-neutral-400">운영진에게 전하고 싶은 말</h4><p className={`mt-2 whitespace-pre-wrap break-words text-sm leading-7 ${row.message ? "text-neutral-200" : "text-neutral-500"}`}>{row.message || "남긴 메시지가 없습니다."}</p></div>
      </article>)}
      <nav aria-label="해지 응답 페이지" className="flex items-center justify-between gap-4 text-sm">{filters.page>1 ? <Link href={pageLink(filters.page-1)} className="rounded-xl border border-white/15 px-4 py-3">이전</Link> : <span/>}<span className="text-neutral-400">{filters.page} / {data.pages} 페이지</span>{filters.page<data.pages ? <Link href={pageLink(filters.page+1)} className="rounded-xl border border-white/15 px-4 py-3">다음</Link> : <span/>}</nav>
    </section>
  </div>;
}
