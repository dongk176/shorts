"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Campaign = {
  id: string;
  name: string;
  effectiveFrom: string;
  effectiveTo: string;
  status: string;
  defaultMinAmountKrw: number;
  notice: string;
};
type Term = {
  id?: string;
  campaignId?: string;
  issuerCode: string;
  issuerName: string;
  benefitType: "interest_free" | "partial_interest_free";
  installmentMonths: number;
  customerPaidInstallments: number | null;
  minAmountKrw: number | null;
  displayOrder: number;
  note: string;
};
type Capability = { installmentMonths: number; enabled: boolean; note: string };

const emptyTerm = (): Term => ({
  issuerCode: "kb", issuerName: "국민카드", benefitType: "interest_free",
  installmentMonths: 2, customerPaidInstallments: null, minAmountKrw: null,
  displayOrder: 0, note: "",
});
const dateOnly = (value: string) => value.slice(0, 10);

export function AdminInstallmentsDashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [allTerms, setAllTerms] = useState<Term[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Campaign | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/billing/installments", { cache: "no-store" });
    const result = await response.json() as {
      campaigns?: Campaign[]; terms?: Term[]; capabilities?: Capability[]; detail?: string;
    };
    if (!response.ok) return setMessage(result.detail || "설정을 불러오지 못했습니다.");
    setCampaigns(result.campaigns || []);
    setAllTerms(result.terms || []);
    setCapabilities(result.capabilities || []);
    setSelectedId((current) => current || result.campaigns?.[0]?.id || "");
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const campaign = campaigns.find((item) => item.id === selectedId) || null;
    setDraft(campaign ? { ...campaign } : null);
    setTerms(allTerms.filter((term) => term.campaignId === selectedId).map((term) => ({ ...term })));
  }, [allTerms, campaigns, selectedId]);

  const supported = useMemo(
    () => new Set(capabilities.filter((item) => item.enabled).map((item) => Number(item.installmentMonths))),
    [capabilities],
  );
  const updateTerm = (index: number, patch: Partial<Term>) => setTerms((current) => (
    current.map((term, termIndex) => termIndex === index ? { ...term, ...patch } : term)
  ));
  const save = async (action: "save" | "publish") => {
    if (!draft) return;
    if (action === "publish" && !window.confirm("이 캠페인을 게시하시겠습니까? 같은 기간의 다른 게시 캠페인과 겹치면 거절됩니다.")) return;
    const response = await fetch("/api/admin/billing/installments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action, campaignId: draft.status === "draft" ? draft.id : null,
        name: draft.name, effectiveFrom: dateOnly(draft.effectiveFrom),
        effectiveTo: dateOnly(draft.effectiveTo),
        defaultMinAmountKrw: Number(draft.defaultMinAmountKrw), notice: draft.notice, terms,
      }),
    });
    const result = await response.json() as { detail?: string };
    setMessage(response.ok ? action === "publish" ? "캠페인을 게시했습니다." : "초안을 저장했습니다." : result.detail || "저장에 실패했습니다.");
    if (response.ok) await load();
  };
  const clone = async () => {
    if (!draft) return;
    const start = window.prompt("새 캠페인 시작일 (YYYY-MM-DD)");
    const end = window.prompt("새 캠페인 종료일 (YYYY-MM-DD)");
    if (!start || !end) return;
    const response = await fetch("/api/admin/billing/installments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clone", sourceCampaignId: draft.id, effectiveFrom: start, effectiveTo: end, name: `${start.slice(0, 7)} 할부 혜택` }),
    });
    const result = await response.json() as { campaign?: Campaign; detail?: string };
    setMessage(response.ok ? "지난 설정을 새 초안으로 복제했습니다." : result.detail || "복제하지 못했습니다.");
    if (response.ok) { await load(); if (result.campaign) setSelectedId(result.campaign.id); }
  };
  const toggleCapability = async (months: number, enabled: boolean) => {
    const response = await fetch("/api/admin/billing/installments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "capability", installmentMonths: months, enabled, note: enabled ? "관리자 PG 지원 확인" : "PG 지원 미확인" }),
    });
    if (response.ok) await load();
  };
  const endCampaign = async () => {
    if (!draft || !window.confirm("게시 중인 캠페인을 종료할까요? 종료 즉시 일시불만 제공될 수 있습니다.")) return;
    const response = await fetch("/api/admin/billing/installments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end", campaignId: draft.id }),
    });
    const result = await response.json() as { detail?: string };
    setMessage(response.ok ? "캠페인을 종료했습니다." : result.detail || "캠페인을 종료하지 못했습니다.");
    if (response.ok) await load();
  };

  return (
    <div className="grid gap-7">
      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-black">할부 혜택 캠페인</h2><p className="mt-1 text-xs text-neutral-500">현재 고객 결제창은 일시불만 제공하며, 이 자료는 관리용으로만 유지됩니다.</p></div>
          <div className="flex gap-2">
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="h-10 max-w-80 rounded-xl border border-white/10 bg-[#191c1d] px-3 text-sm">
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{dateOnly(campaign.effectiveFrom)} · {campaign.name} · {campaign.status}</option>)}
            </select>
            <button type="button" onClick={() => void clone()} className="rounded-xl border border-white/10 px-4 text-sm font-black">지난달 복제</button>
          </div>
        </div>
        {message && <p className="mt-4 rounded-xl bg-[#ff8c7c]/10 px-4 py-3 text-sm text-[#ffb4a8]">{message}</p>}
        {draft && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-neutral-400">이름<input disabled={draft.status !== "draft"} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white" /></label>
          <label className="text-xs font-bold text-neutral-400">시작일<input type="date" disabled={draft.status !== "draft"} value={dateOnly(draft.effectiveFrom)} onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white" /></label>
          <label className="text-xs font-bold text-neutral-400">종료일<input type="date" disabled={draft.status !== "draft"} value={dateOnly(draft.effectiveTo)} onChange={(event) => setDraft({ ...draft, effectiveTo: event.target.value })} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white" /></label>
          <label className="text-xs font-bold text-neutral-400">기본 최소금액<input type="number" disabled={draft.status !== "draft"} value={draft.defaultMinAmountKrw} onChange={(event) => setDraft({ ...draft, defaultMinAmountKrw: Number(event.target.value) })} className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white" /></label>
          <label className="sm:col-span-2 lg:col-span-4 text-xs font-bold text-neutral-400">공통 안내<textarea disabled={draft.status !== "draft"} value={draft.notice} onChange={(event) => setDraft({ ...draft, notice: event.target.value })} rows={2} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white" /></label>
        </div>}
      </section>

      {draft && <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="flex items-center justify-between border-b border-white/10 p-5"><div><h3 className="font-black">카드사별 조건 / 미리보기</h3><p className="mt-1 text-xs text-neutral-500">PG 지원 미확인 개월은 안내에는 보이지만 선택할 수 없습니다.</p></div>{draft.status === "draft" && <button type="button" onClick={() => setTerms((current) => [...current, emptyTerm()])} className="rounded-xl bg-white px-4 py-2 text-sm font-black text-black">행 추가</button>}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="bg-black/20 text-xs text-neutral-500"><tr><th className="px-4 py-3">카드사 코드/이름</th><th className="px-4 py-3">혜택</th><th className="px-4 py-3">개월</th><th className="px-4 py-3">고객 부담</th><th className="px-4 py-3">최소금액</th><th className="px-4 py-3">PG 상태</th><th className="px-4 py-3">관리</th></tr></thead>
          <tbody className="divide-y divide-white/[.06]">{terms.map((term, index) => <tr key={`${term.id || "new"}-${index}`}>
            <td className="px-4 py-3"><input disabled={draft.status !== "draft"} value={term.issuerCode} onChange={(event) => updateTerm(index, { issuerCode: event.target.value })} className="w-20 bg-transparent" /> / <input disabled={draft.status !== "draft"} value={term.issuerName} onChange={(event) => updateTerm(index, { issuerName: event.target.value })} className="w-28 bg-transparent" /></td>
            <td className="px-4 py-3"><select disabled={draft.status !== "draft"} value={term.benefitType} onChange={(event) => updateTerm(index, { benefitType: event.target.value as Term["benefitType"], customerPaidInstallments: event.target.value === "interest_free" ? null : term.customerPaidInstallments || 1 })} className="bg-transparent"><option value="interest_free">무이자</option><option value="partial_interest_free">부분 무이자</option></select></td>
            <td className="px-4 py-3"><input type="number" min={2} max={36} disabled={draft.status !== "draft"} value={term.installmentMonths} onChange={(event) => updateTerm(index, { installmentMonths: Number(event.target.value) })} className="w-16 bg-transparent" />개월</td>
            <td className="px-4 py-3">{term.benefitType === "partial_interest_free" ? <><input type="number" disabled={draft.status !== "draft"} value={term.customerPaidInstallments || 1} onChange={(event) => updateTerm(index, { customerPaidInstallments: Number(event.target.value) })} className="w-14 bg-transparent" />회차</> : "-"}</td>
            <td className="px-4 py-3"><input type="number" disabled={draft.status !== "draft"} value={term.minAmountKrw ?? ""} placeholder={String(draft.defaultMinAmountKrw)} onChange={(event) => updateTerm(index, { minAmountKrw: event.target.value ? Number(event.target.value) : null })} className="w-28 bg-transparent" /></td>
            <td className={`px-4 py-3 font-bold ${supported.has(Number(term.installmentMonths)) ? "text-emerald-300" : "text-amber-300"}`}>{supported.has(Number(term.installmentMonths)) ? "선택 가능" : "PG 지원 확인 중"}</td>
            <td className="px-4 py-3">{draft.status === "draft" && <button type="button" onClick={() => setTerms((current) => current.filter((_, termIndex) => termIndex !== index))} className="text-[#ff9b8d]">삭제</button>}</td>
          </tr>)}</tbody>
        </table></div>
        {draft.status === "draft" && <div className="flex justify-end gap-2 border-t border-white/10 p-5"><button type="button" onClick={() => void save("save")} className="rounded-xl border border-white/10 px-5 py-2.5 font-black">초안 저장</button><button type="button" onClick={() => void save("publish")} className="rounded-xl bg-[#ff806f] px-5 py-2.5 font-black">게시</button></div>}
        {draft.status === "published" && <div className="flex justify-end border-t border-white/10 p-5"><button type="button" onClick={() => void endCampaign()} className="rounded-xl border border-amber-400/30 px-5 py-2.5 font-black text-amber-300">캠페인 종료</button></div>}
      </section>}

      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5">
        <h3 className="font-black">더페이원 할부 승인 capability</h3><p className="mt-1 text-xs text-neutral-500">PG에서 실제 승인 지원을 확인한 뒤에만 활성화하세요.</p>
        <div className="mt-4 flex flex-wrap gap-2">{[2,3,4,5,6,7,8,9,10,11,12,18,23,24,36].map((months) => <label key={months} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm"><input type="checkbox" checked={supported.has(months)} onChange={(event) => void toggleCapability(months, event.target.checked)} />{months}개월</label>)}</div>
      </section>
    </div>
  );
}
