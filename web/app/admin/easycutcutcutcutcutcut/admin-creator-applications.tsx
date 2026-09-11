"use client";
import { useCallback, useEffect, useState } from "react";
import { creatorKstDate } from "@/lib/creator-support";
import { CREATOR_APPLICATION_LIMIT, type CreatorApplication } from "@/lib/creator-application";
type Item = CreatorApplication & { displayName: string | null; email: string | null; termsVersion: string; consentSnapshot: unknown };
type List = { ready: boolean; items: Item[]; total: number; selected: number };
type Detail = { application: Item; audit: Array<{ action: string; reference: string | null; createdAt: string }> };
const states = { pending_review: "검토 대기", selected: "선정·지원 중", rejected: "미선정", withdrawn: "철회", expired: "접수 기간 만료" };
const button = "rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/creator-support/applications${path}`, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(20000),
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.detail || "처리하지 못했습니다."); return result;
}
export function AdminCreatorApplications({ onSelected }: { onSelected: () => void }) {
  const [data, setData] = useState<List | null>(null); const [page, setPage] = useState(1); const [state, setState] = useState("all");
  const [detail, setDetail] = useState<Detail | null>(null); const [busy, setBusy] = useState(false);
  const [reference, setReference] = useState(""); const [confirmed, setConfirmed] = useState(false); const [message, setMessage] = useState("");
  const refresh = useCallback(async () => { setData(await api<List>(`?page=${page}&state=${state}`)); }, [page, state]);
  useEffect(() => { void refresh().catch(error => setMessage(error.message)); }, [refresh]);
  async function open(id: string) {
    setBusy(true); setMessage(""); setReference(""); setConfirmed(false);
    try { setDetail(await api<Detail>(`?id=${id}`)); } catch (error) { setMessage(error instanceof Error ? error.message : "조회 실패"); } finally { setBusy(false); }
  }
  async function act(action: "select" | "reject" | "withdraw") {
    if (!detail || busy) return; setBusy(true); setMessage("");
    try {
      await api("", { action, id: detail.application.id, reference, confirmed });
      await refresh(); setDetail(await api<Detail>(`?id=${detail.application.id}`)); setConfirmed(false); setReference("");
      setMessage(action === "select" ? "선정 완료. 지금부터 월 100분씩 3개월 지원이 시작됐습니다. 연락은 담당자가 직접 진행해 주세요." : "신청을 종료하고 불필요한 연락처·채널 정보를 정리했습니다.");
      onSelected();
    } catch (error) { setMessage(error instanceof Error ? error.message : "처리 실패"); } finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-white/10 p-5" aria-label="파트너 신청 접수 목록">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">신청 접수</h3><p className="mt-1 text-sm text-neutral-400">선정 {data?.selected ?? 0} / {CREATOR_APPLICATION_LIMIT}명 · 신청 단계에서는 사용량이 지급되지 않습니다.</p></div><button className={button} disabled={busy} onClick={() => void refresh().catch(error => setMessage(error.message))}>새로고침</button></div>
    <label className="flex items-center gap-3 text-sm">상태<select className="rounded-lg border border-white/20 bg-neutral-900 p-2" value={state} onChange={e => { setState(e.target.value); setPage(1); }}><option value="all">전체</option>{Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {message && <p role="status" className="rounded-lg bg-white/5 p-3 text-sm">{message}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-neutral-400"><tr>{["신청 계정", "연락처 · 채널", "접수일 · 상태", "관리"].map(title => <th className="p-3" key={title}>{title}</th>)}</tr></thead><tbody>{data?.items.map(item => <tr key={item.id} className="border-t border-white/10 align-top"><td className="p-3">{item.displayName || "이지컷 회원"}<p className="mt-1 text-xs text-neutral-400">{item.email || "이메일 미제공"}</p></td><td className="max-w-sm p-3"><p>{item.phoneNumber || "보관 종료"}</p>{item.channels.map(channel => <a key={channel.platform} className="mt-2 block break-all text-orange-200" href={channel.channelUrl} target="_blank" rel="noreferrer">{channel.platform === "youtube" ? "유튜브" : "인스타그램"} · {channel.channelUrl} ↗</a>)}</td><td className="whitespace-nowrap p-3"><p>{creatorKstDate(item.submittedAt, true)}</p><p className="mt-2 text-orange-200">{states[item.state]}</p></td><td className="p-3"><button className={button} disabled={busy} onClick={() => void open(item.id)}>상세·선정</button></td></tr>)}</tbody></table></div>
    {data?.items.length === 0 && <p className="py-5 text-sm text-neutral-400">접수된 신청이 없습니다.</p>}
    <div className="flex items-center justify-end gap-3 text-sm"><button className={button} disabled={busy || page===1} onClick={() => setPage(page-1)}>이전</button>{page} 페이지 · {data?.total ?? 0}건<button className={button} disabled={busy || page*25 >= (data?.total || 0)} onClick={() => setPage(page+1)}>다음</button></div>
    {detail && <div className="space-y-4 border-t border-white/10 pt-5">
      <div className="flex justify-between gap-3"><h4 className="font-bold">{detail.application.displayName || "이지컷 회원"} · {states[detail.application.state]}</h4><button className={button} onClick={() => setDetail(null)}>상세 닫기</button></div>
      <p className="text-sm">연락처: {detail.application.phoneNumber || "보관 종료"}</p>
      <details className="text-sm"><summary className="cursor-pointer">동의 기록 · {detail.application.termsVersion}</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-neutral-400">{JSON.stringify(detail.application.consentSnapshot, null, 2)}</pre></details>
      {detail.application.state === "pending_review" && <>
        <p className="text-sm text-neutral-300">선정 버튼을 누르면 지금부터 100분씩 3회 지원이 시작됩니다. 연락·시작일 안내와 채널 확인을 마친 뒤 처리해 주세요. 자동 문자 발송은 없습니다.</p>
        <label className="block text-sm">처리 기록<input value={reference} maxLength={500} className="mt-2 w-full rounded-lg border border-white/20 bg-black/20 p-3" placeholder="선정 또는 종료 사유·내부 확인 참조" onChange={e => setReference(e.target.value)} /></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />해당 신청과 처리 내용을 확인했습니다.</label>
        <div className="flex flex-wrap gap-2"><button className={`${button} bg-orange-500/15 text-orange-200`} disabled={busy || !confirmed || reference.trim().length<5 || (data?.selected || 0)>=CREATOR_APPLICATION_LIMIT} onClick={() => void act("select")}>선정하고 지원 시작</button><button className={button} disabled={busy || !confirmed || reference.trim().length<5} onClick={() => void act("reject")}>미선정 처리</button><button className={button} disabled={busy || !confirmed || reference.trim().length<5} onClick={() => void act("withdraw")}>신청 철회 처리</button></div>
      </>}
      {detail.audit.map((event, index) => <p key={index} className="text-xs text-neutral-400">{creatorKstDate(event.createdAt, true)} · {event.action} {event.reference && `· ${event.reference}`}</p>)}
    </div>}
  </section>;
}
