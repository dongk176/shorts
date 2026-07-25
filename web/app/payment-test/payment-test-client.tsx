"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Registration = {
  id: string;
  status: "pending" | "active" | "failed" | "unknown" | "revoking" | "revoked" | "revoke_failed";
  last4: string | null;
  issuer: string | null;
  cardType: string | null;
  acquirer: string | null;
  transactionId: string | null;
  resultCode: string | null;
  createdAt: string;
  revokedAt: string | null;
};

type RecurringAttempt = {
  id: string;
  sequenceNo: number;
  status: "processing" | "succeeded" | "failed" | "unknown";
  amount: number;
  transactionId: string | null;
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

type FormState = {
  payerName: string;
  payerEmail: string;
  payerTel: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  identityNumber: string;
  cardPassword: string;
  consent: boolean;
};

const registrationStatus: Record<Registration["status"], string> = {
  pending: "발급 중",
  active: "사용 가능",
  failed: "발급 실패",
  unknown: "발급 여부 확인 필요",
  revoking: "삭제 중",
  revoked: "삭제 완료",
  revoke_failed: "삭제 재시도 필요",
};

const runStatus: Record<RecurringRun["status"], string> = {
  running: "진행 중",
  completed: "전체 회차 완료",
  stopped: "사용자 중단",
  failed: "실패로 중단",
  unknown: "승인 여부 확인 필요",
};

const attemptStatus: Record<RecurringAttempt["status"], string> = {
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

function won(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function countdown(nextChargeAt: string | null, now: number) {
  if (!nextChargeAt) return "다음 일정 없음";
  const remaining = Math.max(0, new Date(nextChargeAt).getTime() - now);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return remaining === 0 ? "결제 처리 대기 중" : `${minutes}분 ${String(seconds).padStart(2, "0")}초 후`;
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as ({ detail?: string; errorCode?: string | null } & T) | null;
  if (!response.ok) throw new PaymentApiError(body?.detail || "요청을 처리하지 못했습니다.", body?.errorCode || null);
  return (body || {}) as T;
}

function StatusPill({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${danger ? "border-amber-300/25 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[.04] text-neutral-300"}`}>
      {children}
    </span>
  );
}

export function PaymentTestClient({ defaultName, defaultEmail }: { defaultName: string; defaultEmail: string }) {
  const [form, setForm] = useState<FormState>({
    payerName: defaultName,
    payerEmail: defaultEmail,
    payerTel: "",
    cardNumber: "",
    expiryMonth: "",
    expiryYear: "",
    identityNumber: "",
    cardPassword: "",
    consent: false,
  });
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [runs, setRuns] = useState<RecurringRun[]>([]);
  const [config, setConfig] = useState<RecurringConfig>({
    amount: 1000,
    chargeCount: 5,
    intervalSeconds: 180,
    confirmation: "1,000원씩 5회 실제 결제",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [recurringIdentityNumber, setRecurringIdentityNumber] = useState("");
  const [recurringCardPassword, setRecurringCardPassword] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const processingRunRef = useRef<string | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [registrationResponse, runResponse] = await Promise.all([
        fetch("/api/payment-test/card-registrations", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/payment-test/recurring-runs", { cache: "no-store", credentials: "same-origin" }),
      ]);
      const registrationBody = await responseBody<{ registrations?: Registration[] }>(registrationResponse);
      const runBody = await responseBody<{ runs?: RecurringRun[]; config?: RecurringConfig }>(runResponse);
      setRegistrations(registrationBody.registrations || []);
      setRuns(runBody.runs || []);
      if (runBody.config) setConfig(runBody.config);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "결제 테스트 상태를 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => void loadAll(), 10_000);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
    };
  }, [loadAll]);

  const processDueRun = useCallback(async (
    run: RecurringRun,
    identityNumber = recurringIdentityNumber,
    cardPassword = recurringCardPassword,
  ) => {
    if (processingRunRef.current || run.status !== "running" || !run.nextChargeAt) return;
    if (new Date(run.nextChargeAt).getTime() > Date.now()) return;
    const authDob = digits(identityNumber, 10);
    const authPw = digits(cardPassword, 2);
    if (![6, 10].includes(authDob.length) || authPw.length !== 2) return;
    processingRunRef.current = run.id;
    try {
      const response = await fetch(`/api/payment-test/recurring-runs/${run.id}/process`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityNumber: authDob, cardPassword: authPw }),
      });
      const body = await responseBody<{ processed?: boolean; sequenceNo?: number; status?: RecurringRun["status"] }>(response);
      if (body.processed) setNotice({ tone: "success", text: `${body.sequenceNo}회차 1,000원 승인이 완료되었습니다.` });
      if (body.status === "completed") {
        setRecurringIdentityNumber("");
        setRecurringCardPassword("");
      }
    } catch (error) {
      setRecurringIdentityNumber("");
      setRecurringCardPassword("");
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "정기결제 회차 처리에 실패했습니다." });
    } finally {
      processingRunRef.current = null;
      await loadAll();
    }
  }, [loadAll, recurringCardPassword, recurringIdentityNumber]);

  useEffect(() => {
    const activeRegistrationIds = new Set(
      registrations.filter((registration) => registration.status === "active").map((registration) => registration.id),
    );
    const due = runs.find((run) => (
      run.status === "running"
      && activeRegistrationIds.has(run.registrationId)
      && run.nextChargeAt
      && new Date(run.nextChargeAt).getTime() <= now
    ));
    if (
      due
      && [6, 10].includes(digits(recurringIdentityNumber, 10).length)
      && digits(recurringCardPassword, 2).length === 2
    ) void processDueRun(due);
  }, [now, processDueRun, recurringCardPassword, recurringIdentityNumber, registrations, runs]);

  function update<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const cardFormValid = Boolean(
    form.payerName.trim()
    && form.payerEmail.trim()
    && digits(form.payerTel, 11).length >= 10
    && digits(form.cardNumber, 19).length >= 13
    && /^(0[1-9]|1[0-2])$/.test(form.expiryMonth)
    && /^\d{2}$/.test(form.expiryYear)
    && [6, 10].includes(digits(form.identityNumber, 10).length)
    && digits(form.cardPassword, 2).length === 2
    && form.consent,
  );

  async function createRecurringRun(
    registration: Registration,
    identityNumber = recurringIdentityNumber,
    cardPassword = recurringCardPassword,
  ) {
    const response = await fetch("/api/payment-test/recurring-runs", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: crypto.randomUUID(),
        registrationId: registration.id,
        payerName: form.payerName.trim(),
        payerEmail: form.payerEmail.trim(),
        payerTel: digits(form.payerTel, 11),
        confirmation: config.confirmation,
        consent: true,
      }),
    });
    const body = await responseBody<{ run?: RecurringRun }>(response);
    if (!body.run) throw new PaymentApiError("반복결제 일정을 생성하지 못했습니다.");
    await processDueRun(body.run, identityNumber, cardPassword);
    return body.run;
  }

  async function registerBillingKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cardFormValid || busy) return;
    setBusy("register");
    setNotice(null);
    const identityNumber = digits(form.identityNumber, 10);
    const cardPassword = digits(form.cardPassword, 2);
    try {
      const response = await fetch("/api/payment-test/card-registrations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          cardNumber: digits(form.cardNumber, 19),
          expiry: `${form.expiryYear}${form.expiryMonth}`,
          identityNumber: digits(form.identityNumber, 10),
          cardPassword: digits(form.cardPassword, 2),
          consent: form.consent,
        }),
      });
      const body = await responseBody<{ registration: Registration }>(response);
      setRecurringIdentityNumber(identityNumber);
      setRecurringCardPassword(cardPassword);
      setForm((current) => ({
        ...current,
        cardNumber: "",
        expiryMonth: "",
        expiryYear: "",
        identityNumber: "",
        cardPassword: "",
        consent: false,
      }));
      await createRecurringRun(body.registration, identityNumber, cardPassword);
      setNotice({ tone: "success", text: "더페이원 0원 카드 등록과 1회차 1,000원 승인이 완료되었습니다. 다음 승인은 3분 뒤 실행됩니다." });
      await loadAll();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "더페이원 카드 등록 또는 반복결제 시작에 실패했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function startRecurring(registration: Registration) {
    if (
      ![6, 10].includes(digits(recurringIdentityNumber, 10).length)
      || digits(recurringCardPassword, 2).length !== 2
    ) {
      setNotice({ tone: "error", text: "반복 승인에 사용할 생년월일 6자리 또는 사업자번호 10자리와 카드 비밀번호 앞 2자리를 입력해 주세요." });
      return;
    }
    if (busy || !window.confirm(`${config.confirmation}를 시작할까요? 첫 결제는 즉시 승인됩니다.`)) return;
    setBusy(`run-${registration.id}`);
    setNotice(null);
    try {
      await createRecurringRun(registration);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "정기결제 테스트를 시작하지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function stopRecurring(run: RecurringRun) {
    if (busy || !window.confirm("아직 승인되지 않은 다음 회차부터 중단할까요? 이미 승인된 결제는 취소되지 않습니다.")) return;
    setBusy(`stop-${run.id}`);
    try {
      const response = await fetch(`/api/payment-test/recurring-runs/${run.id}/stop`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await responseBody(response);
      setRecurringIdentityNumber("");
      setRecurringCardPassword("");
      setNotice({ tone: "success", text: "다음 정기결제 회차를 중단했습니다." });
      await loadAll();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "정기결제를 중단하지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function expireBillingKey(registration: Registration) {
    if (busy || !window.confirm(`끝번호 ${registration.last4 || "----"} 카드 등록을 폐기할까요?`)) return;
    setBusy(`expire-${registration.id}`);
    try {
      const response = await fetch(`/api/payment-test/card-registrations/${registration.id}/revoke`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      await responseBody(response);
      setRecurringIdentityNumber("");
      setRecurringCardPassword("");
      setNotice({ tone: "success", text: "더페이원 카드 등록을 폐기하고 저장된 암호화 cardId를 삭제했습니다." });
      await loadAll();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "카드 등록을 폐기하지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-white/10 bg-[#191c1e]/95 p-6 shadow-2xl sm:p-8">
        <p className="text-xs font-extrabold uppercase tracking-[.2em] text-[#ff9b8d]">ThePayOne · Live API · Local only</p>
        <h1 className="mt-4 text-[28px] font-black tracking-[-.04em] sm:text-[32px]">구독 결제 카드 등록</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-neutral-400">
          더페이원에 0원으로 카드를 등록한 직후 1회차 1,000원을 승인하고, 이후 3분 간격으로 총 5회까지 검증합니다. 카드번호·생년월일·비밀번호는 저장하지 않고 발급된 cardId만 암호화해 보관합니다.
        </p>
        {notice && (
          <div role={notice.tone === "error" ? "alert" : "status"} className={`mt-5 rounded-xl border p-4 text-sm ${notice.tone === "error" ? "border-red-400/25 bg-red-500/10 text-red-100" : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"}`}>
            {notice.text}
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-white/10 bg-[#191c1e]/90 p-6 sm:p-8">
        <p className="text-xs font-black uppercase tracking-[.18em] text-violet-300">0원 등록 + 반복 승인</p>
        <h2 className="mt-3 text-2xl font-black">더페이원 카드 등록</h2>
        <p className="mt-3 text-sm leading-7 text-neutral-400">/api/auth에 amount=0, udf2=00, authPw를 포함해 cardId만 발급합니다. 등록 성공 직후 /api/pay로 첫 승인을 실행합니다.</p>
        <form onSubmit={registerBillingKey} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold text-neutral-300">이름<input value={form.payerName} onChange={(event) => update("payerName", event.target.value.slice(0, 30))} autoComplete="name" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
          <label className="text-xs font-bold text-neutral-300">이메일<input type="email" value={form.payerEmail} onChange={(event) => update("payerEmail", event.target.value.slice(0, 60))} autoComplete="email" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
          <label className="text-xs font-bold text-neutral-300">휴대전화<input inputMode="numeric" value={form.payerTel} onChange={(event) => update("payerTel", digits(event.target.value, 11))} placeholder="01012345678" autoComplete="tel" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
          <label className="text-xs font-bold text-neutral-300">카드번호 13~19자리<input inputMode="numeric" value={formattedCardNumber(form.cardNumber)} onChange={(event) => update("cardNumber", digits(event.target.value, 19))} placeholder="1234 5678 9012 3456" autoComplete="cc-number" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-neutral-300">유효기간 월<input inputMode="numeric" value={form.expiryMonth} onChange={(event) => update("expiryMonth", digits(event.target.value, 2))} placeholder="MM" autoComplete="cc-exp-month" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
            <label className="text-xs font-bold text-neutral-300">유효기간 연도<input inputMode="numeric" value={form.expiryYear} onChange={(event) => update("expiryYear", digits(event.target.value, 2))} placeholder="YY" autoComplete="cc-exp-year" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="text-xs font-bold text-neutral-300">생년월일 6자리 / 사업자번호 10자리<input inputMode="numeric" value={form.identityNumber} onChange={(event) => update("identityNumber", digits(event.target.value, 10))} autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
            <label className="text-xs font-bold text-neutral-300">비밀번호 앞 2자리<input type="password" inputMode="numeric" value={form.cardPassword} onChange={(event) => update("cardPassword", digits(event.target.value, 2))} autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
          </div>
          <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-white/8 bg-black/15 p-4 text-xs leading-6 text-neutral-300"><input type="checkbox" checked={form.consent} onChange={(event) => update("consent", event.target.checked)} className="mt-1 h-4 w-4 accent-violet-300" /><span>본인 또는 정당한 권한이 있는 카드로 0원 카드 등록 후 1,000원씩 최대 5회(총 5,000원) 실제 승인을 진행하는 데 동의합니다.</span></label>
          <button type="submit" disabled={!cardFormValid || busy !== null} className="sm:col-span-2 min-h-12 rounded-xl bg-violet-300 px-5 text-sm font-black text-violet-950 disabled:cursor-not-allowed disabled:opacity-40">{busy === "register" ? "더페이원 등록 및 첫 승인 중..." : "0원 카드 등록 후 3분 간격 5회 테스트"}</button>
        </form>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[24px] border border-white/10 bg-[#191c1e]/90 p-6">
          <h2 className="text-lg font-black">등록된 카드 ID</h2>
          <p className="mt-2 text-xs leading-6 text-neutral-500">자동 시작이 실패하거나 중단한 경우 활성 cardId로 3분 간격 5회 테스트를 다시 시작할 수 있습니다.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_150px]">
            <label className="text-xs font-bold text-neutral-300">반복 승인용 생년월일 / 사업자번호<input inputMode="numeric" value={recurringIdentityNumber} onChange={(event) => setRecurringIdentityNumber(digits(event.target.value, 10))} autoComplete="off" placeholder="6자리 또는 10자리" className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
            <label className="text-xs font-bold text-neutral-300">카드 비밀번호 앞 2자리<input type="password" inputMode="numeric" value={recurringCardPassword} onChange={(event) => setRecurringCardPassword(digits(event.target.value, 2))} autoComplete="off" placeholder="2자리" className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-neutral-500">더페이원 요청 시에만 사용하며 DB·로그·브라우저 저장소에는 저장하지 않습니다. 새로고침하면 다시 입력해야 합니다.</p>
          <div className="mt-4 space-y-3">
            {loading ? <p className="text-sm text-neutral-500">불러오는 중...</p> : registrations.length === 0 ? <p className="text-sm text-neutral-500">등록된 cardId가 없습니다.</p> : registrations.map((registration) => (
              <article key={registration.id} className="rounded-xl border border-white/8 bg-black/15 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{registration.issuer || "카드"} · •••• {registration.last4 || "----"}</strong><StatusPill danger={registration.status === "unknown"}>{registrationStatus[registration.status]}</StatusPill></div>
                <p className="mt-2 text-xs text-neutral-500">{dateTime(registration.createdAt)}{registration.resultCode ? ` · ${registration.resultCode}` : ""}</p>
                {registration.status === "active" && (
                  <div className="mt-4 flex gap-2"><button type="button" disabled={busy !== null || digits(form.payerTel, 11).length < 10} onClick={() => void startRecurring(registration)} className="min-h-10 flex-1 rounded-lg bg-violet-300 px-3 text-xs font-black text-violet-950 disabled:opacity-40">{busy === `run-${registration.id}` ? "시작 중..." : "3분 간격 5회 결제"}</button><button type="button" disabled={busy !== null} onClick={() => void expireBillingKey(registration)} className="min-h-10 rounded-lg border border-white/10 px-3 text-xs font-bold text-neutral-400">폐기</button></div>
                )}
                {registration.status === "revoke_failed" && <button type="button" disabled={busy !== null} onClick={() => void expireBillingKey(registration)} className="mt-4 min-h-10 w-full rounded-lg border border-amber-300/20 px-3 text-xs font-bold text-amber-100">삭제 재시도</button>}
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-[#191c1e]/90 p-6">
          <h2 className="text-lg font-black">3분 간격 실행 내역</h2>
          <p className="mt-2 text-xs leading-6 text-neutral-500">이 로컬 페이지를 열어 둔 동안 각 회차가 도래하면 한 번씩 실행됩니다.</p>
          <div className="mt-4 space-y-4">
            {runs.length === 0 ? <p className="text-sm text-neutral-500">정기결제 테스트 내역이 없습니다.</p> : runs.map((run) => (
              <article key={run.id} className="rounded-xl border border-white/8 bg-black/15 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">•••• {run.cardLast4 || "----"} · {run.succeededChargeCount}/{run.targetChargeCount}회</strong><StatusPill danger={run.status === "unknown"}>{runStatus[run.status]}</StatusPill></div>
                <p className="mt-2 text-xs text-neutral-500">{run.status === "running" ? countdown(run.nextChargeAt, now) : dateTime(run.completedAt || run.stoppedAt || run.createdAt)}</p>
                <ol className="mt-3 space-y-2">{run.attempts.map((attempt) => <li key={attempt.id} className="flex items-center justify-between rounded-lg bg-white/[.03] px-3 py-2 text-xs"><span>{attempt.sequenceNo}회차 · {won(attempt.amount)}</span><span className={attempt.status === "unknown" ? "text-amber-200" : "text-neutral-400"}>{attemptStatus[attempt.status]}{attempt.resultCode ? ` · ${attempt.resultCode}` : ""}</span></li>)}</ol>
                {run.status === "running" && <button type="button" disabled={busy !== null} onClick={() => void stopRecurring(run)} className="mt-4 min-h-10 w-full rounded-lg border border-white/10 px-3 text-xs font-bold text-neutral-400">{busy === `stop-${run.id}` ? "중단 중..." : "다음 회차부터 중단"}</button>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-amber-300/15 bg-amber-400/[.06] p-5 text-xs leading-6 text-amber-50/80">
        <strong className="block text-amber-100">테스트 종료 후 확인</strong>
        <span className="mt-1 block">활성 cardId는 반드시 ‘폐기’하고, 성공·실패·unknown 거래를 더페이원 관리자에서 trackId로 대조하세요. 더페이원은 별도 테스트 서버가 없어 실제 승인으로 처리되며, 결과가 불명확한 요청은 재호출하지 않습니다.</span>
      </section>
    </div>
  );
}
