"use client";

import { useCallback, useEffect, useState } from "react";

type Registration = {
  id: string;
  status: "pending" | "active" | "failed" | "revoking" | "revoked" | "revoke_failed";
  last4: string | null;
  issuer: string | null;
  cardType: string | null;
  acquirer: string | null;
  providerTransactionId: string | null;
  resultCode: string | null;
  createdAt: string;
  revokedAt: string | null;
};

type FormState = {
  payerName: string;
  payerEmail: string;
  payerTel: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  authDob: string;
  authPw: string;
  consent: boolean;
};

const statusLabels: Record<Registration["status"], string> = {
  pending: "등록 처리 중",
  active: "등록 완료",
  failed: "등록 실패",
  revoking: "폐기 처리 중",
  revoked: "폐기 완료",
  revoke_failed: "폐기 재시도 필요",
};

function digits(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

function formattedCardNumber(value: string) {
  return digits(value, 19).replace(/(.{4})/g, "$1 ").trim();
}

async function responseBody(response: Response) {
  const body = await response.json().catch(() => null) as { detail?: string } | null;
  if (!response.ok) throw new Error(body?.detail || "요청을 처리하지 못했습니다.");
  return body;
}

export function PaymentTestClient({ defaultName, defaultEmail }: { defaultName: string; defaultEmail: string }) {
  const [form, setForm] = useState<FormState>({
    payerName: defaultName,
    payerEmail: defaultEmail,
    payerTel: "",
    cardNumber: "",
    expiryMonth: "",
    expiryYear: "",
    authDob: "",
    authPw: "",
    consent: false,
  });
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const loadRegistrations = useCallback(async () => {
    try {
      const response = await fetch("/api/payment-test/card-registrations", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await responseBody(response) as { registrations?: Registration[] };
      setRegistrations(body.registrations || []);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "등록 내역을 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRegistrations();
  }, [loadRegistrations]);

  const canSubmit = Boolean(
    form.payerName.trim()
    && form.payerEmail.trim()
    && digits(form.payerTel, 11).length >= 10
    && digits(form.cardNumber, 19).length >= 13
    && /^(0[1-9]|1[0-2])$/.test(form.expiryMonth)
    && /^\d{2}$/.test(form.expiryYear)
    && [6, 10].includes(digits(form.authDob, 10).length)
    && digits(form.authPw, 2).length === 2
    && form.consent,
  );

  function update<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/payment-test/card-registrations", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          cardNumber: digits(form.cardNumber, 19),
          expiry: `${form.expiryYear}${form.expiryMonth}`,
          authDob: digits(form.authDob, 10),
          authPw: digits(form.authPw, 2),
          consent: form.consent,
        }),
      });
      const body = await responseBody(response) as { registration?: Registration };
      if (body.registration) setRegistrations((current) => [body.registration!, ...current]);
      setForm((current) => ({
        ...current,
        cardNumber: "",
        expiryMonth: "",
        expiryYear: "",
        authDob: "",
        authPw: "",
        consent: false,
      }));
      setNotice({ tone: "success", text: "0원 카드 등록이 완료되었습니다. 자동청구 일정은 생성되지 않았습니다." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "카드 등록에 실패했습니다." });
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(registration: Registration) {
    if (revokingId || !window.confirm(`끝번호 ${registration.last4 || "----"} 카드 등록을 폐기할까요?`)) return;
    setRevokingId(registration.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/payment-test/card-registrations/${registration.id}/revoke`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      await responseBody(response);
      setRegistrations((current) => current.map((item) => (
        item.id === registration.id ? { ...item, status: "revoked", revokedAt: new Date().toISOString() } : item
      )));
      setNotice({ tone: "success", text: "더페이원 카드 등록을 폐기하고 저장된 암호화 토큰도 삭제했습니다." });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "카드 등록 폐기에 실패했습니다." });
      await loadRegistrations();
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[26px] border border-white/10 bg-[#191c1e]/90 shadow-[0_28px_90px_rgba(0,0,0,.28)]">
        <div className="border-b border-white/10 bg-gradient-to-r from-[#ff715e]/10 via-transparent to-[#a078ff]/10 px-6 py-7 sm:px-9">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#ff9b8d]">ThePayOne · Local only</p>
              <h1 className="mt-3 text-3xl font-black tracking-[-.045em] sm:text-4xl">0원 카드 등록 테스트</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-400">카드 토큰만 발급하며 결제와 자동청구 일정은 만들지 않습니다. 테스트 후 아래 내역에서 바로 폐기할 수 있습니다.</p>
            </div>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-300">결제금액 0원</span>
          </div>
        </div>

        <form onSubmit={submit} autoComplete="off" className="grid gap-7 px-6 py-8 sm:px-9 lg:grid-cols-2">
          <fieldset className="space-y-5" disabled={submitting}>
            <legend className="mb-5 text-sm font-extrabold text-neutral-200">등록자 정보</legend>
            <label className="block text-xs font-bold text-neutral-400">
              이름
              <input required maxLength={20} value={form.payerName} onChange={(event) => update("payerName", event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 text-sm text-white outline-none transition focus:border-[#a078ff]" />
            </label>
            <label className="block text-xs font-bold text-neutral-400">
              이메일
              <input required type="email" maxLength={100} value={form.payerEmail} onChange={(event) => update("payerEmail", event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 text-sm text-white outline-none transition focus:border-[#a078ff]" />
            </label>
            <label className="block text-xs font-bold text-neutral-400">
              휴대전화
              <input required inputMode="numeric" placeholder="01012345678" maxLength={13} value={form.payerTel} onChange={(event) => update("payerTel", digits(event.target.value, 11))} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 text-sm text-white outline-none transition focus:border-[#a078ff]" />
            </label>
          </fieldset>

          <fieldset className="space-y-5" disabled={submitting}>
            <legend className="mb-5 text-sm font-extrabold text-neutral-200">카드 인증 정보</legend>
            <label className="block text-xs font-bold text-neutral-400">
              카드번호
              <input required inputMode="numeric" autoComplete="cc-number" placeholder="0000 0000 0000 0000" maxLength={23} value={formattedCardNumber(form.cardNumber)} onChange={(event) => update("cardNumber", digits(event.target.value, 19))} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 font-mono text-sm tracking-[.08em] text-white outline-none transition focus:border-[#ff715e]" />
            </label>
            <div className="grid grid-cols-3 gap-4">
              <label className="block text-xs font-bold text-neutral-400">
                유효기간 월(MM)
                <input required inputMode="numeric" autoComplete="cc-exp-month" placeholder="07" maxLength={2} value={form.expiryMonth} onChange={(event) => update("expiryMonth", digits(event.target.value, 2))} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 font-mono text-sm text-white outline-none transition focus:border-[#ff715e]" />
              </label>
              <label className="block text-xs font-bold text-neutral-400">
                유효기간 연도(YY)
                <input required inputMode="numeric" autoComplete="cc-exp-year" placeholder="29" maxLength={2} value={form.expiryYear} onChange={(event) => update("expiryYear", digits(event.target.value, 2))} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 font-mono text-sm text-white outline-none transition focus:border-[#ff715e]" />
              </label>
              <label className="block text-xs font-bold text-neutral-400">
                비밀번호 앞 2자리
                <input required type="password" inputMode="numeric" autoComplete="off" placeholder="••" maxLength={2} value={form.authPw} onChange={(event) => update("authPw", digits(event.target.value, 2))} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 font-mono text-sm text-white outline-none transition focus:border-[#ff715e]" />
              </label>
            </div>
            <label className="block text-xs font-bold text-neutral-400">
              생년월일 6자리 또는 사업자번호 10자리
              <input required type="password" inputMode="numeric" autoComplete="off" placeholder="YYMMDD" maxLength={10} value={form.authDob} onChange={(event) => update("authDob", digits(event.target.value, 10))} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 font-mono text-sm text-white outline-none transition focus:border-[#ff715e]" />
            </label>
          </fieldset>

          <div className="lg:col-span-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-4 text-xs leading-6 text-neutral-300">
              <input type="checkbox" checked={form.consent} onChange={(event) => update("consent", event.target.checked)} className="mt-1 h-4 w-4 accent-[#ff715e]" />
              <span>본인 또는 정당한 권한이 있는 카드로 0원 카드등록 인증을 진행하며, 카드 원문은 Easy Cut DB에 저장되지 않는다는 점을 확인했습니다.</span>
            </label>
            <button type="submit" disabled={!canSubmit || submitting} className="mt-5 flex min-h-13 w-full items-center justify-center rounded-xl bg-[#f04435] px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_12px_32px_rgba(240,68,53,.22)] transition hover:bg-[#ff5d4d] disabled:cursor-not-allowed disabled:opacity-45">
              {submitting ? "더페이원에 등록 중…" : "0원으로 카드 등록 테스트"}
            </button>
          </div>
        </form>
      </section>

      {notice && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-red-400/20 bg-red-400/10 text-red-200"}`}>
          {notice.text}
        </div>
      )}

      <section className="rounded-[22px] border border-white/10 bg-[#191c1e]/80 p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-lg font-extrabold">최근 테스트 내역</h2><p className="mt-1 text-xs text-neutral-500">카드번호 대신 발급 결과와 끝 4자리만 표시합니다.</p></div>
          <button type="button" onClick={() => void loadRegistrations()} disabled={loading} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-neutral-300 hover:border-white/20 disabled:opacity-50">새로고침</button>
        </div>
        <div className="mt-6 space-y-3">
          {loading ? <p className="py-8 text-center text-sm text-neutral-500">불러오는 중…</p> : registrations.length === 0 ? <p className="py-8 text-center text-sm text-neutral-500">아직 카드 등록 테스트 내역이 없습니다.</p> : registrations.map((registration) => {
            const canRevoke = registration.status === "active" || registration.status === "revoke_failed";
            return (
              <article key={registration.id} className="flex flex-col gap-4 rounded-xl border border-white/[.08] bg-[#101415] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{registration.issuer || "카드"} ···· {registration.last4 || "----"}</strong>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${registration.status === "active" ? "bg-emerald-400/10 text-emerald-300" : registration.status === "revoked" ? "bg-white/5 text-neutral-400" : registration.status.includes("failed") ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}>{statusLabels[registration.status]}</span>
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">{new Date(registration.createdAt).toLocaleString("ko-KR")} · 결과 {registration.resultCode || "확인 중"}</p>
                </div>
                {canRevoke && <button type="button" disabled={revokingId === registration.id} onClick={() => void revoke(registration)} className="rounded-lg border border-red-400/20 px-3 py-2 text-xs font-bold text-red-300 transition hover:bg-red-400/10 disabled:opacity-50">{revokingId === registration.id ? "폐기 중…" : registration.status === "revoke_failed" ? "폐기 재시도" : "등록 폐기"}</button>}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
