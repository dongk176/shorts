"use client";

import Image from "next/image";
import { creatorApplicationTerms as creatorSupportTerms, CREATOR_APPLICATION_TERMS_VERSION as CREATOR_SUPPORT_TERMS_VERSION } from "@/lib/creator-application";
import { AdminCreatorApplications } from "./admin-creator-applications";
import { useCallback, useEffect, useState } from "react";
import { creatorKstDate, type CreatorSupportStatus } from "@/lib/creator-support";

type Program = { enrollmentOpen: boolean; retiredAt: string | null; legalReviewVersion: string | null; legalReviewReference: string | null; legalReviewedAt: string | null };
type Item = {
  id: string; channelName: string | null; channelUrl: string | null; platform: string; email: string | null; displayName: string | null;
  activatedAt: string; supportEndsAt: string; promotionEndsAt: string; promotionStatus: string; eligible: boolean; takedownCompletedAt: string | null;
};
type Dashboard = { schemaReady: boolean; program: Program | null; items: Item[]; total: number };
type Detail = {
  enrollment: { id: string; assetId: string | null; termsVersion: string; consentedAt: string; consentSnapshot: unknown; materialDeletedAt: string | null };
  status: CreatorSupportStatus;
  audit: Array<{ action: string; reference: string | null; createdAt: string; actorId: string | null }>;
};
const statusLabels: Record<string, string> = { pending: "권리 확인 대기", approved: "홍보 사용 가능", stopped: "홍보 중단", expired: "홍보 기간 종료" };
const actionLabels: Record<string, string> = {
  enrolled: "참여·동의 완료", verify_rights: "권리 확인 완료", stop: "철회·종료 처리", takedown_complete: "외부 게시·광고 중단 확인",
  materials_deleted: "소재·공개 정보 삭제", promotion_expired: "홍보 기간 종료", account_withdrawn: "서비스 회원 탈퇴",
};
async function adminApi<T>(path = "", body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin/creator-support${path}`, {
    cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(20_000),
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "처리하지 못했습니다.");
  return data as T;
}
const buttonClass = "rounded-lg border border-white/20 px-3 py-2 text-sm text-neutral-200 disabled:opacity-40";

export function AdminCreatorSupport() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [page, setPage] = useState(1);
  const [eligible, setEligible] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reference, setReference] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [verified, setVerified] = useState(false);
  const [legalReference, setLegalReference] = useState("");
  const [retireConfirmed, setRetireConfirmed] = useState(false);
  const refresh = useCallback(async () => {
    try { setData(await adminApi<Dashboard>(`?page=${page}&eligible=${eligible}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "목록을 불러오지 못했습니다."); }
  }, [page, eligible]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function openDetail(id: string) {
    setError(""); setBusy(true); setReference(""); setVerified(false);
    try { setDetail(await adminApi<Detail>(`?id=${id}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "상세 정보를 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function mutate(body: unknown, success: string) {
    setError(""); setMessage(""); setBusy(true);
    try {
      await adminApi("", body); await refresh();
      if (detail) setDetail(await adminApi<Detail>(`?id=${detail.enrollment.id}`));
      setMessage(success); setReference(""); setVerified(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5 text-neutral-200" data-i18n-skip>
    <div className="rounded-2xl border border-white/10 bg-white/[.025] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">크리에이터 지원</h2><p className="mt-1 text-sm text-neutral-400">10명 선정 · 선정 후 매월 100분 × 3회 · 기존 참여자의 지급은 유지</p></div><a href="/creator-support" target="_blank" rel="noreferrer" className={buttonClass}>신청 화면 보기 ↗</a></div>
      <div className="mt-5 flex flex-wrap items-center gap-3"><strong className={data?.program?.enrollmentOpen ? "text-emerald-300" : "text-orange-200"}>신규 모집 {data?.program?.enrollmentOpen ? "ON" : "OFF"}</strong><button className={buttonClass} disabled={busy || !data?.schemaReady || Boolean(data.program?.retiredAt)} onClick={() => void mutate({ action: "recruitment", open: !data?.program?.enrollmentOpen }, "모집 상태를 변경했습니다. 기존 참여자의 지급 일정은 유지됩니다.")}>{data?.program?.enrollmentOpen ? "모집 중단" : "모집 시작"}</button><span className="text-xs text-neutral-400">모집 중단은 기존 참여자의 지급에 영향을 주지 않습니다.</span></div>
      {data && !data.schemaReady && <p className="mt-3 text-sm text-orange-200">데이터베이스 변경 적용 전입니다. 신규 모집은 OFF 상태입니다.</p>}
      <details className="mt-4 rounded-xl border border-white/10 p-4"><summary className="cursor-pointer text-sm font-semibold">공개 전 이용약정 법률 검토 · {CREATOR_SUPPORT_TERMS_VERSION}</summary>
        <p className="my-3 text-xs text-neutral-400">완료 기록: {data?.program?.legalReviewVersion === CREATOR_SUPPORT_TERMS_VERSION && data.program.legalReviewedAt ? `${creatorKstDate(data.program.legalReviewedAt, true)} · ${data.program.legalReviewReference}` : "아직 없음"}</p>
        <p className="mb-3 text-sm text-neutral-300">필수 참여 동의, 제공받는 자·보유 기간, 광고 플랫폼 국외 이전, 1년 이용약정 및 철회 처리 조건을 실제 법률 검토한 뒤 기록해 주세요. 모집 시작은 검토 완료 기록이 있어야 가능합니다.</p>
        {creatorSupportTerms.map((term) => <details key={term.key} className="my-2 text-sm"><summary className="cursor-pointer text-orange-200">{term.title}</summary>{term.paragraphs.map((paragraph) => <p className="my-3 leading-7 text-neutral-400" key={paragraph}>{paragraph}</p>)}</details>)}
        <label className="mt-4 block text-sm">검토 문서·티켓 참조<input className="mt-2 w-full rounded-lg border border-white/20 bg-black/20 p-3" value={legalReference} maxLength={500} placeholder="개인정보를 적지 말고 검토 문서 번호 또는 내부 링크를 입력" onChange={(e) => setLegalReference(e.target.value)} /></label>
        <label className="my-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />현재 버전의 이용약정에 대한 법률 검토가 실제로 완료됐습니다.</label>
        <button className={buttonClass} disabled={busy || !data?.schemaReady || !reviewed || legalReference.trim().length < 5} onClick={() => void mutate({ action: "legal_review", reference: legalReference, reviewed: true, termsVersion: CREATOR_SUPPORT_TERMS_VERSION }, "법률 검토 완료 기록을 저장했습니다.")}>검토 완료 기록 저장</button>
      </details>
      <details className="mt-3 rounded-xl border border-white/10 p-4 text-sm"><summary className="cursor-pointer">프로그램 영구 종료·최소 기록 보관 종료</summary><p className="my-3 text-neutral-400">영구 종료 후 같은 프로그램의 모집을 다시 열 수 없습니다. 기존 지급·이용약정은 유지되며, 지원 종료 후 1년이 지나면 중복 참여 확인용 최소 기록도 정리됩니다.</p><label className="flex items-start gap-2"><input type="checkbox" checked={retireConfirmed} onChange={(e) => setRetireConfirmed(e.target.checked)} />이번 프로그램의 신규 모집을 영구 종료합니다.</label><button className={`${buttonClass} mt-3`} disabled={busy || !retireConfirmed || !data?.schemaReady || Boolean(data.program?.retiredAt)} onClick={() => void mutate({ action: "retire", reference: "관리자 화면에서 모집 영구 종료 확인", confirmed: true }, "모집을 영구 종료했습니다. 기존 지원 약속은 유지됩니다.")}>{data?.program?.retiredAt ? "영구 종료됨" : "모집 영구 종료"}</button></details>
    </div>
    <AdminCreatorApplications onSelected={() => { void refresh(); }} />
    {error && <p role="alert" className="rounded-xl bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-200">{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex gap-2 text-sm"><input type="checkbox" checked={eligible} onChange={(e) => { setEligible(e.target.checked); setPage(1); }} />권리 확인이 완료된 홍보 사용 가능 목록만</label><div className="flex gap-2"><button className={buttonClass} disabled={busy} onClick={() => void refresh()}>새로고침</button><button className={buttonClass} disabled={busy || !data?.schemaReady} onClick={() => void mutate({ action: "maintenance" }, "종료 및 보관 기간이 지난 자료를 정리했습니다. 외부 게시·광고 중단은 아래에서 별도로 확인해 주세요.")}>종료·자료 정리 실행</button></div></div>
    <div className="overflow-x-auto rounded-xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/5 text-xs text-neutral-400"><tr>{["신청 계정 / 채널", "활성화 / 지원 종료", "홍보 상태 / 종료", "관리"].map((title) => <th key={title} className="px-4 py-3">{title}</th>)}</tr></thead><tbody>{data?.items.map((item) => <tr key={item.id} className="border-t border-white/10 align-top"><td className="px-4 py-4"><p>{item.displayName || "이름 없음"} · {item.email || "이메일 없음"}</p>{item.channelUrl ? <a className="mt-1 block text-orange-200" href={item.channelUrl} target="_blank" rel="noreferrer">{item.channelName} ↗</a> : <span className="text-xs text-neutral-500">보관 종료된 채널 정보</span>}</td><td className="whitespace-nowrap px-4 py-4 text-xs leading-6">{creatorKstDate(item.activatedAt, true)}<br />~ {creatorKstDate(item.supportEndsAt, true)}</td><td className="px-4 py-4 text-xs leading-6"><strong className={item.eligible ? "text-emerald-300" : "text-orange-200"}>{statusLabels[item.promotionStatus]}</strong><p>{creatorKstDate(item.promotionEndsAt, true)}</p>{["stopped", "expired"].includes(item.promotionStatus) && <p className={item.takedownCompletedAt ? "text-neutral-500" : "text-red-300"}>{item.takedownCompletedAt ? "외부 게시·광고 중단 확인됨" : "외부 게시·광고 중단 확인 필요"}</p>}</td><td className="px-4 py-4"><button className={buttonClass} disabled={busy} onClick={() => void openDetail(item.id)}>상세·처리</button></td></tr>)}</tbody></table>{data?.items.length === 0 && <p className="p-6 text-sm text-neutral-400">해당 신청이 없습니다.</p>}</div>
    <div className="flex items-center justify-end gap-3"><button className={buttonClass} disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>이전</button><span className="text-xs">{page} 페이지 · {data?.total || 0}건</span><button className={buttonClass} disabled={!data || page * 25 >= data.total || busy} onClick={() => setPage(page + 1)}>다음</button></div>
    {detail && <section className="space-y-4 rounded-2xl border border-orange-200/20 bg-white/[.025] p-5" aria-label="신청 상세">
      <div className="flex items-center justify-between gap-3"><h3 className="font-bold">{detail.status.channelName || "종료된 신청"} · 지원·동의 기록</h3><button className={buttonClass} onClick={() => setDetail(null)}>닫기</button></div>
      {detail.enrollment.assetId && <Image src={`/api/creator-support/assets/${detail.enrollment.assetId}`} width={80} height={80} alt="제공된 프로필 이미지" unoptimized className="rounded-xl" />}
      <div className="grid gap-3 sm:grid-cols-3">{detail.status.installments.map((grant) => <div key={grant.number} className="rounded-xl border border-white/10 p-4 text-xs leading-6"><strong>{grant.number}회차 · {{ available: "지급 완료", scheduled: "지급 예정", expired: "만료", canceled: "취소" }[grant.state]}</strong><p>{creatorKstDate(grant.validFrom, true)}부터<br />{creatorKstDate(grant.expiresAt, true)}까지</p><p>현재 잔여 {Math.floor(grant.remainingSeconds / 60)}분 {grant.remainingSeconds % 60}초</p></div>)}</div>
      <details className="text-sm"><summary className="cursor-pointer">동의 기록 · {detail.enrollment.termsVersion} · {creatorKstDate(detail.enrollment.consentedAt, true)}</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-4 text-xs">{detail.enrollment.consentSnapshot ? JSON.stringify(detail.enrollment.consentSnapshot, null, 2) : "보관 기간이 종료된 동의 상세 기록입니다."}</pre></details>
      <label className="block text-sm">권리 확인·요청 처리 참조<input value={reference} maxLength={500} className="mt-2 w-full rounded-lg border border-white/20 bg-black/20 p-3" placeholder="운영 권한·소재 권리 확인 문서 또는 고객센터 티켓 번호" onChange={(e) => setReference(e.target.value)} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />채널 운영·소재 권한을 확인했고, 실제 게시 매체의 개인정보 제공·국외 이전 요건도 확인했습니다.</label>
      <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || !verified || reference.trim().length < 5 || ["stopped", "expired"].includes(detail.status.promotionStatus)} onClick={() => void mutate({ action: "verify_rights", id: detail.enrollment.id, reference, verified: true }, "권리 확인을 기록했습니다. 게시나 광고 집행은 자동 실행되지 않습니다.")}>권리 확인 완료</button><button className={`${buttonClass} text-red-200`} disabled={busy || reference.trim().length < 5} onClick={() => void mutate({ action: "stop", id: detail.enrollment.id, reference }, "홍보를 중단하고 미래 지급을 취소했습니다. 공개 정보·이미지를 삭제했으며 이미 시작한 회차는 유지됩니다. 외부 광고도 중단해 주세요.")}>철회·종료 처리</button><button className={buttonClass} disabled={busy || reference.trim().length < 5 || !["stopped", "expired"].includes(detail.status.promotionStatus)} onClick={() => void mutate({ action: "takedown_complete", id: detail.enrollment.id, reference }, "외부 게시·광고 중단 확인을 기록했습니다.")}>게시·광고 중단 확인</button></div>
      <p className="text-xs leading-6 text-neutral-400">철회·종료 처리: 홍보 중단, 미래 회차 취소, 공개 정보·이미지 삭제. 이미 시작한 회차는 원래 만료일까지 유지하며 자동 위약금·환수는 없습니다. 외부 게시물·광고를 실제로 중단한 뒤 확인을 기록하세요.</p>
      <ol className="space-y-2 border-t border-white/10 pt-4 text-xs text-neutral-400">{detail.audit.map((item, index) => <li key={`${item.createdAt}-${index}`}>{creatorKstDate(item.createdAt, true)} · {actionLabels[item.action] || item.action}{item.reference ? ` · ${item.reference}` : ""}</li>)}</ol>
    </section>}
  </section>;
}
