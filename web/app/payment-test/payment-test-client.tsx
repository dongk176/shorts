"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  cardIssuer: "" | "bc" | "kb" | "shinhan" | "samsung" | "hyundai" | "lotte" | "nh" | "woori" | "hana" | "other";
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

type RecurringAttempt = {
  id: string;
  sequenceNo: number;
  status: "processing" | "succeeded" | "failed" | "unknown";
  amount: number;
  providerTransactionId: string | null;
  resultCode: string | null;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string | null;
};

type RecurringRun = {
  id: string;
  registrationId: string;
  status: "running" | "completed" | "stopped" | "failed" | "unknown";
  amount: number;
  intervalSeconds: number;
  targetChargeCount: number;
  succeededChargeCount: number;
  nextChargeAt: string | null;
  startedAt: string;
  completedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  cardLast4: string | null;
  cardIssuer: string | null;
  attempts: RecurringAttempt[];
};

type RecurringConfig = {
  amount: number;
  chargeCount: number;
  intervalSeconds: number;
  confirmation: string;
};

type Overlay =
  | { kind: "hana" }
  | { kind: "recurring-confirm"; registration: Registration }
  | null;

const statusLabels: Record<Registration["status"], string> = {
  pending: "등록 처리 중",
  active: "등록 완료",
  failed: "등록 실패",
  revoking: "폐기 처리 중",
  revoked: "폐기 완료",
  revoke_failed: "폐기 재시도 필요",
};

const issuerOptions = [
  ["", "카드사를 선택해 주세요"],
  ["bc", "BC카드"],
  ["kb", "KB국민카드"],
  ["shinhan", "신한카드"],
  ["samsung", "삼성카드"],
  ["hyundai", "현대카드"],
  ["lotte", "롯데카드"],
  ["nh", "NH농협카드"],
  ["woori", "우리카드"],
  ["hana", "하나카드 (등록 불가)"],
  ["other", "기타 카드사"],
] as const;

const recurringStatusLabels: Record<RecurringRun["status"], string> = {
  running: "진행 중",
  completed: "3회 완료",
  stopped: "사용자 중단",
  failed: "결제 실패로 중단",
  unknown: "승인 여부 확인 필요",
};

const attemptStatusLabels: Record<RecurringAttempt["status"], string> = {
  processing: "승인 처리 중",
  succeeded: "승인 성공",
  failed: "승인 실패",
  unknown: "승인 여부 확인 필요",
};

class PaymentApiError extends Error {
  constructor(message: string, readonly errorCode: string | null = null) {
    super(message);
  }
}

function digits(value: string, maxLength: number) {
  return value.replace(/[^0-9]/g, "").slice(0, maxLength);
}

function formattedCardNumber(value: string) {
  return digits(value, 19).replace(/(.{4})/g, "$1 ").trim();
}

async function responseBody(response: Response) {
  const body = await response.json().catch(() => null) as { detail?: string; errorCode?: string | null } | null;
  if (!response.ok) throw new PaymentApiError(body?.detail || "요청을 처리하지 못했습니다.", body?.errorCode || null);
  return body;
}

function isHanaIssuer(value: string | null | undefined) {
  return Boolean(value && /(하나|외환|hana|keb)/i.test(value));
}

function countdown(nextChargeAt: string | null, now: number) {
  if (!nextChargeAt) return "대기 일정 없음";
  const remaining = Math.max(0, new Date(nextChargeAt).getTime() - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return remaining === 0 ? "결제 처리 대기 중" : `${minutes}분 ${String(seconds).padStart(2, "0")}초 후`;
}

export function PaymentTestClient({ defaultName, defaultEmail }: { defaultName: string; defaultEmail: string }) {
  const [form, setForm] = useState<FormState>({
    cardIssuer: "",
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
  const [recurringRuns, setRecurringRuns] = useState<RecurringRun[]>([]);
  const [recurringConfig, setRecurringConfig] = useState<RecurringConfig>({
    amount: 1000,
    chargeCount: 3,
    intervalSeconds: 60,
    confirmation: "1,000원씩 3회 실제 결제",
  });
  const [runsLoading, setRunsLoading] = useState(true);
  const [startingRun, setStartingRun] = useState(false);
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [recurringConsent, setRecurringConsent] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const processingRunRef = useRef<string | null>(null);

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

  const loadRecurringRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/payment-test/recurring-runs", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await responseBody(response) as { runs?: RecurringRun[]; config?: RecurringConfig };
      setRecurringRuns(body.runs || []);
      if (body.config) setRecurringConfig(body.config);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "반복결제 상태를 불러오지 못했습니다." });
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadRegistrations(), loadRecurringRuns()]);
  }, [loadRegistrations, loadRecurringRuns]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => void loadRecurringRuns(), 10_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(refresh);
    };
  }, [loadRecurringRuns]);

  const processDueRun = useCallback(async (run: RecurringRun) => {
    if (processingRunRef.current || run.status !== "running" || !run.nextChargeAt) return;
    if (new Date(run.nextChargeAt).getTime() > Date.now()) return;
    processingRunRef.current = run.id;
    try {
      const response = await fetch(`/api/payment-test/recurring-runs/${run.id}/process`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await responseBody(response) as { processed?: boolean; sequenceNo?: number };
      if (body.processed) {
        setNotice({ tone: "success", text: `${body.sequenceNo || "다음"}회차 1,000원 결제가 승인되었습니다.` });
      }
    } catch (error) {
      const paymentError = error instanceof PaymentApiError ? error : null;
      if (paymentError?.errorCode === "HANA_CARD_UNSUPPORTED") setOverlay({ kind: "hana" });
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "반복결제 처리에 실패했습니다." });
    } finally {
      processingRunRef.current = null;
      await loadRecurringRuns();
    }
  }, [loadRecurringRuns]);

  useEffect(() => {
    const dueRun = recurringRuns.find((run) => (
      run.status === "running"
      && run.nextChargeAt
      && new Date(run.nextChargeAt).getTime() <= now
    ));
    if (dueRun) void processDueRun(dueRun);
  }, [now, processDueRun, recurringRuns]);

  const canSubmit = Boolean(
    form.cardIssuer
    && form.cardIssuer !== "hana"
    && form.payerName.trim()
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

  function selectCardIssuer(value: FormState["cardIssuer"]) {
    update("cardIssuer", value);
    if (value === "hana") setOverlay({ kind: "hana" });
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
          cardIssuer: form.cardIssuer,
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
        cardIssuer: "",
        cardNumber: "",
        expiryMonth: "",
        expiryYear: "",
        authDob: "",
        authPw: "",
        consent: false,
      }));
      setNotice({ tone: "success", text: "0원 카드 등록이 완료되었습니다. 자동청구 일정은 생성되지 않았습니다." });
    } catch (error) {
      if (error instanceof PaymentApiError && error.errorCode === "HANA_CARD_UNSUPPORTED") {
        setOverlay({ kind: "hana" });
      }
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "카드 등록에 실패했습니다." });
    } finally {
      setSubmitting(false);
    }
  }

  async function startRecurringRun(registration: Registration) {
    if (!recurringConsent || startingRun) return;
    setStartingRun(true);
    setNotice(null);
    try {
      const response = await fetch("/api/payment-test/recurring-runs", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          registrationId: registration.id,
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          confirmation: recurringConfig.confirmation,
          consent: true,
        }),
      });
      const body = await responseBody(response) as { run?: RecurringRun };
      if (!body.run?.id) throw new PaymentApiError("반복결제 테스트 일정을 생성하지 못했습니다.");
      processingRunRef.current = body.run.id;
      const processResponse = await fetch(`/api/payment-test/recurring-runs/${body.run.id}/process`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
      });
      const processBody = await responseBody(processResponse) as { processed?: boolean; sequenceNo?: number };
      if (!processBody.processed) throw new PaymentApiError("첫 결제를 즉시 처리하지 못했습니다. 진행 상태를 새로고침해 주세요.");
      setOverlay(null);
      setRecurringConsent(false);
      setNotice({ tone: "success", text: "1회차 1,000원 결제가 승인되었습니다. 다음 결제는 1분 뒤 실행됩니다." });
      await loadRecurringRuns();
    } catch (error) {
      if (error instanceof PaymentApiError && error.errorCode === "HANA_CARD_UNSUPPORTED") {
        setOverlay({ kind: "hana" });
      }
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "반복결제 테스트 시작에 실패했습니다." });
    } finally {
      processingRunRef.current = null;
      setStartingRun(false);
    }
  }

  async function stopRecurringRun(run: RecurringRun) {
    if (stoppingRunId || !window.confirm("아직 실행되지 않은 다음 결제부터 즉시 중단할까요? 이미 승인된 결제는 자동 취소되지 않습니다.")) return;
    setStoppingRunId(run.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/payment-test/recurring-runs/${run.id}/stop`, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
      });
      await responseBody(response);
      setNotice({ tone: "success", text: "다음 반복결제를 중단했습니다. 이미 승인된 결제는 유지됩니다." });
      await loadRecurringRuns();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "반복결제 중단에 실패했습니다." });
    } finally {
      setStoppingRunId(null);
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
              카드사
              <select required value={form.cardIssuer} onChange={(event) => selectCardIssuer(event.target.value as FormState["cardIssuer"])} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-[#101415] px-4 text-sm text-white outline-none transition focus:border-[#ff715e]">
                {issuerOptions.map(([value, label]) => <option key={value || "empty"} value={value}>{label}</option>)}
              </select>
            </label>
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

      <section className="overflow-hidden rounded-[24px] border border-amber-300/20 bg-[#191c1e]/90 shadow-[0_24px_70px_rgba(0,0,0,.24)]">
        <div className="border-b border-white/10 bg-gradient-to-r from-amber-400/10 via-transparent to-red-400/10 px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[.18em] text-amber-300">Real charge · Local only</p>
              <h2 className="mt-2 text-2xl font-black tracking-[-.035em]">즉시 시작 · 1분 간격 반복결제 테스트</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">시작 즉시 1,000원을 승인하고, 성공 시점부터 1분 간격으로 2회 더 승인합니다. 이 화면을 열어 둔 동안 결제 시각을 감지하며, 새로고침이나 서버 재시작 후에도 DB 일정에서 이어집니다.</p>
            </div>
            <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-xs font-extrabold text-amber-200">최대 실제 결제 3,000원</span>
          </div>
        </div>
        <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[.9fr_1.1fr]">
          <div>
            <h3 className="text-sm font-extrabold text-neutral-200">사용할 등록 카드</h3>
            <p className="mt-1 text-xs leading-5 text-neutral-500">이름·이메일·휴대전화는 위 등록자 정보 값을 사용합니다.</p>
            <div className="mt-4 space-y-3">
              {registrations.filter((registration) => registration.status === "active").length === 0 ? (
                <p className="rounded-xl border border-white/[.08] bg-[#101415] px-4 py-5 text-sm text-neutral-500">먼저 0원 카드 등록을 완료해 주세요.</p>
              ) : registrations.filter((registration) => registration.status === "active").map((registration) => {
                const hana = isHanaIssuer(registration.issuer);
                const blockingRun = recurringRuns.find((run) => run.status === "running" || run.status === "unknown");
                const payerReady = Boolean(form.payerName.trim() && form.payerEmail.trim() && digits(form.payerTel, 11).length >= 10);
                return (
                  <article key={registration.id} className="rounded-xl border border-white/[.08] bg-[#101415] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[.16em] text-amber-300">사용 카드</p>
                        <strong className="mt-1 block text-base text-white">{registration.issuer || registration.acquirer || "카드사 정보 없음"}</strong>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                          <span className="rounded-md border border-white/10 bg-white/[.04] px-2 py-1 font-mono text-neutral-200">카드번호 •••• {registration.last4 || "----"}</span>
                          {registration.cardType && <span className="rounded-md border border-white/10 bg-white/[.04] px-2 py-1 text-neutral-300">카드 구분 {registration.cardType}</span>}
                          {registration.acquirer && registration.acquirer !== registration.issuer && <span className="rounded-md border border-white/10 bg-white/[.04] px-2 py-1 text-neutral-300">매입사 {registration.acquirer}</span>}
                        </div>
                        <p className="mt-2 text-[11px] text-neutral-500">카드 토큰 암호화 저장됨</p>
                      </div>
                      <button
                        type="button"
                        disabled={startingRun}
                        onClick={() => {
                          if (hana) {
                            setOverlay({ kind: "hana" });
                            return;
                          }
                          if (blockingRun) {
                            setNotice({
                              tone: "error",
                              text: blockingRun.status === "unknown"
                                ? "승인 여부를 확인해야 하는 결제가 있습니다. PG 관리자 화면에서 확인한 뒤 새 테스트를 시작해 주세요."
                                : "이미 진행 중인 반복결제 테스트가 있습니다. 기존 테스트를 중단하거나 완료한 뒤 다시 시도해 주세요.",
                            });
                            return;
                          }
                          if (!payerReady) {
                            setNotice({ tone: "error", text: "반복결제에 사용할 이름·이메일·휴대전화를 위에서 입력해 주세요." });
                            return;
                          }
                          setRecurringConsent(false);
                          setOverlay({ kind: "recurring-confirm", registration });
                        }}
                        className="rounded-lg bg-amber-300 px-3.5 py-2 text-xs font-black text-[#2b2100] transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {hana ? "사용 불가 안내" : blockingRun ? "진행 중인 테스트 확인" : "3회 결제 테스트 시작"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-extrabold text-neutral-200">반복결제 진행 상태</h3>
              <button type="button" onClick={() => void loadRecurringRuns()} disabled={runsLoading} className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-bold text-neutral-300 disabled:opacity-50">새로고침</button>
            </div>
            <div className="mt-4 space-y-3">
              {runsLoading ? (
                <p className="rounded-xl border border-white/[.08] bg-[#101415] px-4 py-5 text-sm text-neutral-500">불러오는 중…</p>
              ) : recurringRuns.length === 0 ? (
                <p className="rounded-xl border border-white/[.08] bg-[#101415] px-4 py-5 text-sm text-neutral-500">아직 반복결제 테스트 내역이 없습니다.</p>
              ) : recurringRuns.map((run) => (
                <article key={run.id} className={`rounded-xl border p-4 ${run.status === "unknown" ? "border-red-400/30 bg-red-400/[.07]" : "border-white/[.08] bg-[#101415]"}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm">{run.cardIssuer || "카드"} ···· {run.cardLast4 || "----"}</strong>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${run.status === "completed" ? "bg-emerald-400/10 text-emerald-300" : run.status === "running" ? "bg-amber-300/10 text-amber-200" : run.status === "unknown" || run.status === "failed" ? "bg-red-400/10 text-red-300" : "bg-white/5 text-neutral-400"}`}>{recurringStatusLabels[run.status]}</span>
                      </div>
                      <p className="mt-2 text-xs text-neutral-500">승인 {run.succeededChargeCount}/{run.targetChargeCount}회 · 다음 일정 {run.status === "running" ? countdown(run.nextChargeAt, now) : "종료"}</p>
                    </div>
                    {run.status === "running" && (
                      <button type="button" disabled={stoppingRunId === run.id} onClick={() => void stopRecurringRun(run)} className="rounded-lg border border-red-400/20 px-3 py-2 text-[11px] font-bold text-red-300 hover:bg-red-400/10 disabled:opacity-50">{stoppingRunId === run.id ? "중단 중…" : "다음 결제 중단"}</button>
                    )}
                  </div>
                  {run.status === "unknown" && <p className="mt-3 rounded-lg bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-200">자동 재시도하지 않습니다. PG 관리자 화면에서 해당 시각의 승인 내역을 확인해 주세요.</p>}
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    {Array.from({ length: run.targetChargeCount }, (_, index) => {
                      const attempt = run.attempts.find((item) => item.sequenceNo === index + 1);
                      return (
                        <div key={index} className="rounded-lg border border-white/[.06] bg-black/20 px-3 py-2.5">
                          <p className="text-[10px] font-black text-neutral-500">{index + 1}회차 · 1,000원</p>
                          <p className={`mt-1 text-xs font-bold ${attempt?.status === "succeeded" ? "text-emerald-300" : attempt?.status === "unknown" || attempt?.status === "failed" ? "text-red-300" : "text-neutral-300"}`}>{attempt ? attemptStatusLabels[attempt.status] : "대기"}</p>
                          {attempt?.resultCode && <p className="mt-1 text-[10px] text-neutral-600">결과 {attempt.resultCode}</p>}
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

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

      {overlay && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 px-5 backdrop-blur-sm" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="payment-overlay-title" className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#191c1e] p-6 shadow-[0_30px_100px_rgba(0,0,0,.6)] sm:p-7">
            {overlay.kind === "hana" ? (
              <>
                <div className="grid h-11 w-11 place-items-center rounded-full bg-red-400/10 text-xl" aria-hidden="true">!</div>
                <h2 id="payment-overlay-title" className="mt-5 text-2xl font-black tracking-[-.035em]">하나카드는 등록할 수 없어요</h2>
                <p className="mt-3 text-sm leading-7 text-neutral-400">현재 더페이원 정기결제 카드 등록에서 하나카드는 지원되지 않습니다. KB국민·신한·삼성·현대·롯데·NH농협·BC·우리카드 등 다른 카드를 이용해 주세요.</p>
                <button type="button" onClick={() => { setOverlay(null); if (form.cardIssuer === "hana") update("cardIssuer", ""); }} className="mt-6 w-full rounded-xl bg-[#f04435] px-4 py-3 text-sm font-extrabold text-white hover:bg-[#ff5d4d]">다른 카드 선택하기</button>
              </>
            ) : (
              <>
                <p className="text-[11px] font-black uppercase tracking-[.18em] text-amber-300">실제 카드 승인</p>
                <h2 id="payment-overlay-title" className="mt-3 text-2xl font-black tracking-[-.035em]">총 3,000원이 결제됩니다</h2>
                <p className="mt-3 text-sm leading-7 text-neutral-400">{overlay.registration.issuer || "카드"} 끝번호 {overlay.registration.last4 || "----"}로 1,000원씩 총 3회 실제 승인합니다. 첫 결제는 버튼을 누르면 즉시 실행되고, 이후 성공 시점부터 1분 간격으로 2회 더 실행됩니다. 중단해도 이미 승인된 금액은 자동 취소되지 않습니다.</p>
                <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[.07] p-4 text-xs leading-6 text-amber-100">
                  <input type="checkbox" checked={recurringConsent} onChange={(event) => setRecurringConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-amber-300" />
                  <span>본인 또는 정당한 권한이 있는 카드이며, {recurringConfig.confirmation}에 동의합니다.</span>
                </label>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button type="button" disabled={startingRun} onClick={() => { setOverlay(null); setRecurringConsent(false); }} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-neutral-300 hover:bg-white/5 disabled:opacity-50">취소</button>
                  <button type="button" disabled={!recurringConsent || startingRun} onClick={() => void startRecurringRun(overlay.registration)} className="rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-[#2b2100] hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40">{startingRun ? "첫 결제 승인 중…" : "즉시 결제 시작"}</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
