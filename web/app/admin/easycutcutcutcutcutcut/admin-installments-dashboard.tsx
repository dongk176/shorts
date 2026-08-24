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
type Capability = {
  credentialScope: "default" | "manual" | "package";
  installmentMonths: number;
  enabled: boolean;
  note: string;
  verifiedAt?: string | null;
};
type ManualPaymentFlag = {
  flagKey: "package_manual_billing" | "addon_manual_billing";
  enabled: boolean;
  updatedAt: string;
};
type PaymentModes = {
  package: "legacy" | "manual" | "disabled";
  addon: "legacy" | "manual" | "disabled";
  credentialsEnabled: boolean;
};

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
  const [manualPaymentFlags, setManualPaymentFlags] = useState<ManualPaymentFlag[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentModes>({
    package: "legacy",
    addon: "legacy",
    credentialsEnabled: false,
  });
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Campaign | null>(null);
  const [terms, setTerms] = useState<Term[]>([]);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/billing/installments", { cache: "no-store" });
    const result = await response.json() as {
      campaigns?: Campaign[];
      terms?: Term[];
      capabilities?: Capability[];
      manualPaymentFlags?: ManualPaymentFlag[];
      paymentModes?: PaymentModes;
      detail?: string;
    };
    if (!response.ok) return setMessage(result.detail || "설정을 불러오지 못했습니다.");
    setCampaigns(result.campaigns || []);
    setAllTerms(result.terms || []);
    setCapabilities(result.capabilities || []);
    setManualPaymentFlags(result.manualPaymentFlags || []);
    if (result.paymentModes) setPaymentModes(result.paymentModes);
    setSelectedId((current) => current || result.campaigns?.[0]?.id || "");
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const campaign = campaigns.find((item) => item.id === selectedId) || null;
    setDraft(campaign ? { ...campaign } : null);
    setTerms(allTerms.filter((term) => term.campaignId === selectedId).map((term) => ({ ...term })));
  }, [allTerms, campaigns, selectedId]);

  const manualSupported = useMemo(
    () => new Set(capabilities
      .filter((item) => (
        item.enabled
        && (item.credentialScope === "manual" || item.credentialScope === "package")
      ))
      .map((item) => Number(item.installmentMonths))),
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
  const toggleCapability = async (
    credentialScope: Capability["credentialScope"],
    months: number,
    enabled: boolean,
  ) => {
    const existing = capabilities.find(
      (item) => item.credentialScope === credentialScope
        && Number(item.installmentMonths) === months,
    );
    const note = enabled && credentialScope === "manual"
      ? window.prompt(
        "arti02 수기결제 터미널의 지원 확인 근거를 입력하세요. 실승인한 개월은 PG 승인·취소 거래번호도 함께 남겨 주세요.",
        existing?.note || "",
      )
      : enabled
        ? existing?.note || "관리자 PG 지원 확인"
        : existing?.note || "PG 지원 미확인";
    if (note === null || (enabled && credentialScope === "manual" && !note.trim())) return;
    const response = await fetch("/api/admin/billing/installments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "capability",
        credentialScope,
        installmentMonths: months,
        enabled,
        note,
      }),
    });
    const result = await response.json() as { detail?: string };
    if (response.ok) {
      setMessage(`${credentialScope === "manual" ? "arti02 수기결제" : "기본"} 터미널 ${months}개월 capability를 ${enabled ? "활성화" : "비활성화"}했습니다.`);
      await load();
    } else {
      setMessage(result.detail || "터미널 capability를 변경하지 못했습니다.");
    }
  };
  const toggleManualPayment = async (
    productKind: "package" | "addon",
    enabled: boolean,
  ) => {
    const response = await fetch("/api/admin/billing/installments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "manual_payment_flag",
        productKind,
        enabled,
      }),
    });
    const result = await response.json() as { detail?: string };
    setMessage(response.ok
      ? `${productKind === "package" ? "패키지" : "추가시간"} 수기결제를 ${enabled ? "활성화" : "중지"}했습니다.`
      : result.detail || "수기결제 운영 설정을 변경하지 못했습니다.");
    if (response.ok) await load();
  };
  const endCampaign = async () => {
    if (!draft || !window.confirm("게시 중인 캠페인을 종료할까요? 일반 할부는 유지되지만 무이자·부분 무이자 혜택 표시는 즉시 종료됩니다.")) return;
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
          <div><h2 className="text-lg font-black">할부 혜택 캠페인</h2><p className="mt-1 text-xs text-neutral-500">arti02 capability가 일반 할부 범위를 정하고, 카드사 캠페인과 일치하는 개월에는 무이자·부분 무이자 혜택을 표시합니다.</p></div>
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
            <td className={`px-4 py-3 font-bold ${manualSupported.has(Number(term.installmentMonths)) ? "text-emerald-300" : "text-amber-300"}`}>{manualSupported.has(Number(term.installmentMonths)) ? "일회성 결제 선택 가능" : "arti02 확인 중"}</td>
            <td className="px-4 py-3">{draft.status === "draft" && <button type="button" onClick={() => setTerms((current) => current.filter((_, termIndex) => termIndex !== index))} className="text-[#ff9b8d]">삭제</button>}</td>
          </tr>)}</tbody>
        </table></div>
        {draft.status === "draft" && <div className="flex justify-end gap-2 border-t border-white/10 p-5"><button type="button" onClick={() => void save("save")} className="rounded-xl border border-white/10 px-5 py-2.5 font-black">초안 저장</button><button type="button" onClick={() => void save("publish")} className="rounded-xl bg-[#ff806f] px-5 py-2.5 font-black">게시</button></div>}
        {draft.status === "published" && <div className="flex justify-end border-t border-white/10 p-5"><button type="button" onClick={() => void endCampaign()} className="rounded-xl border border-amber-400/30 px-5 py-2.5 font-black text-amber-300">캠페인 종료</button></div>}
      </section>}

      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5">
        <h3 className="font-black">일회성 수기결제 운영 스위치</h3>
        <p className="mt-1 text-xs leading-5 text-neutral-500">
          환경 모드가 manual이고 arti02 자격증명이 활성화된 경우에만 아래 스위치가 실제 결제를 엽니다. 중지 시 arti01로 자동 전환하지 않습니다.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(["package", "addon"] as const).map((productKind) => {
            const key = productKind === "package"
              ? "package_manual_billing"
              : "addon_manual_billing";
            const enabled = Boolean(
              manualPaymentFlags.find((item) => item.flagKey === key)?.enabled,
            );
            const environmentMode = paymentModes[productKind];
            const effective = enabled
              && environmentMode === "manual"
              && paymentModes.credentialsEnabled;
            return (
              <div key={productKind} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/15 p-4">
                <div>
                  <strong className="text-sm text-white">
                    {productKind === "package" ? "패키지" : "추가시간"}
                  </strong>
                  <p className="mt-1 text-xs text-neutral-500">
                    환경 {environmentMode} · 실제 {effective ? "활성" : "중지"}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs font-bold text-neutral-300">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => void toggleManualPayment(
                      productKind,
                      event.target.checked,
                    )}
                  />
                  운영 ON
                </label>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5">
        <h3 className="font-black">더페이원 할부 승인 capability</h3><p className="mt-1 text-xs text-neutral-500">가맹점 터미널별 일반 할부 지원 범위를 관리합니다. arti02 고객 결제창은 활성 capability를 최대 12개월까지 노출하고 캠페인 일치 개월에만 혜택을 표시합니다.</p>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {([
            ["default", "기본 터미널"],
            ["manual", "arti02 일회성 수기결제 터미널"],
          ] as const).map(([scope, label]) => {
            const scoped = capabilities.filter((item) => item.credentialScope === scope);
            const supported = new Set(
              scoped.filter((item) => item.enabled).map((item) => Number(item.installmentMonths)),
            );
            const availableMonths = scope === "manual"
              ? [2,3,4,5,6,7,8,9,10,11,12]
              : [2,3,4,5,6,7,8,9,10,11,12,18,23,24,36];
            return (
              <div key={scope} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                <h4 className="text-sm font-black">{label}</h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  {availableMonths.map((months) => (
                    <label key={months} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={supported.has(months)}
                        onChange={(event) => void toggleCapability(
                          scope,
                          months,
                          event.target.checked,
                        )}
                      />
                      {months}개월
                    </label>
                  ))}
                </div>
                {scoped.filter((item) => item.note).map((item) => (
                  <p key={item.installmentMonths} className="mt-2 text-xs leading-5 text-neutral-500">
                    {item.installmentMonths}개월 · {item.note}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
