"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Registration = {
  id: string;
  credentialScope: "default" | "package";
  merchantId: string | null;
  terminalId: string | null;
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

type PackageScenarioName = "cash_1000" | "installment_50000_3m";
type PackageScenario = {
  amount: number;
  installmentMonths: number;
  label: string;
  chargeConfirmation: string;
  refundConfirmation: string;
};
type PackageOrder = {
  id: string;
  registrationId: string | null;
  paymentInputMode: "registered_card" | "manual_direct";
  scenario: PackageScenarioName;
  label: string;
  amount: number;
  installmentMonths: number;
  orderId: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "unknown" | "manual_review";
  merchantId: string;
  terminalId: string;
  transactionId: string | null;
  authCode: string | null;
  resultCode: string | null;
  responseAmount: number | null;
  responseInstallmentMonths: number | null;
  responseIssuer: string | null;
  responseCardType: string | null;
  responseCardLast4: string | null;
  approvedAt: string | null;
  refundStatus: "none" | "processing" | "succeeded" | "failed" | "unknown" | "manual_review";
  refundTrackId: string | null;
  refundTransactionId: string | null;
  refundResultCode: string | null;
  refundResponseAmount: number | null;
  refundResponseTerminalId: string | null;
  refundedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
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

const packageOrderStatus: Record<PackageOrder["status"], string> = {
  pending: "대기",
  processing: "승인 처리 중",
  succeeded: "승인 성공",
  failed: "승인 실패",
  unknown: "승인 여부 확인 필요",
  manual_review: "응답 불일치 수동 대조",
};

const packageRefundStatus: Record<PackageOrder["refundStatus"], string> = {
  none: "환불 전",
  processing: "환불 처리 중",
  succeeded: "전액환불 성공",
  failed: "환불 실패",
  unknown: "환불 여부 확인 필요",
  manual_review: "환불 응답 수동 대조",
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
  const [packageOrders, setPackageOrders] = useState<PackageOrder[]>([]);
  const [packageScenarios, setPackageScenarios] = useState<Record<PackageScenarioName, PackageScenario>>({
    cash_1000: {
      amount: 1000,
      installmentMonths: 0,
      label: "1,000원 일시불",
      chargeConfirmation: "1,000원 일시불 실제 승인",
      refundConfirmation: "1,000원 전액환불",
    },
    installment_50000_3m: {
      amount: 50000,
      installmentMonths: 3,
      label: "50,000원 3개월 할부",
      chargeConfirmation: "50,000원 3개월 할부 실제 승인",
      refundConfirmation: "50,000원 전액환불",
    },
  });
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
      const [registrationResponse, runResponse, packageResponse] = await Promise.all([
        fetch("/api/payment-test/card-registrations", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/payment-test/recurring-runs", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/payment-test/package-orders", { cache: "no-store", credentials: "same-origin" }),
      ]);
      const registrationBody = await responseBody<{ registrations?: Registration[] }>(registrationResponse);
      const runBody = await responseBody<{ runs?: RecurringRun[]; config?: RecurringConfig }>(runResponse);
      const packageBody = await responseBody<{
        orders?: PackageOrder[];
        scenarios?: Record<PackageScenarioName, PackageScenario>;
      }>(packageResponse);
      setRegistrations(registrationBody.registrations || []);
      setRuns(runBody.runs || []);
      setPackageOrders(packageBody.orders || []);
      if (runBody.config) setConfig(runBody.config);
      if (packageBody.scenarios) setPackageScenarios(packageBody.scenarios);
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

  function clearCardAuthenticationFields() {
    setForm((current) => ({
      ...current,
      cardNumber: "",
      expiryMonth: "",
      expiryYear: "",
      identityNumber: "",
      cardPassword: "",
      consent: false,
    }));
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
          credentialScope: "default",
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
      clearCardAuthenticationFields();
      await createRecurringRun(body.registration, identityNumber, cardPassword);
      setNotice({ tone: "success", text: "기본 터미널 0원 카드 등록과 1회차 1,000원 승인이 완료되었습니다. 다음 승인은 3분 뒤 실행됩니다." });
      await loadAll();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "더페이원 카드 등록 또는 반복결제 시작에 실패했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function chargePackage(scenarioName: PackageScenarioName) {
    if (!cardFormValid) {
      setNotice({ tone: "error", text: "수기결제에 사용할 카드정보와 동의 항목을 모두 입력해 주세요." });
      return;
    }
    const scenario = packageScenarios[scenarioName];
    if (
      busy
      || !window.confirm(
        `${scenario.chargeConfirmation}을 arti02 수기결제로 실행합니다. 실제 카드 승인이 발생하며 자동 재시도되지 않습니다.${scenario.installmentMonths > 0 ? " 체크카드는 거절 예상이며, 예외적으로 승인되면 50,000원 전액이 즉시 출금되어 PG 대조 후 환불해야 합니다." : ""}`,
      )
    ) return;
    setBusy(`package-${scenarioName}`);
    setNotice(null);
    try {
      const response = await fetch("/api/payment-test/package-orders", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          scenario: scenarioName,
          confirmation: scenario.chargeConfirmation,
          payerName: form.payerName.trim(),
          payerEmail: form.payerEmail.trim(),
          payerTel: digits(form.payerTel, 11),
          cardNumber: digits(form.cardNumber, 19),
          expiry: `${form.expiryYear}${form.expiryMonth}`,
          identityNumber: digits(form.identityNumber, 10),
          cardPassword: digits(form.cardPassword, 2),
        }),
      });
      const body = await responseBody<{ order?: PackageOrder }>(response);
      if (!body.order) throw new PaymentApiError("패키지 테스트 승인 원장을 확인하지 못했습니다.");
      clearCardAuthenticationFields();
      setNotice({ tone: "success", text: `${scenario.label} 승인이 확정됐습니다. PG 대조 후 전액환불하세요.` });
      await loadAll();
    } catch (error) {
      clearCardAuthenticationFields();
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "패키지 테스트 승인에 실패했습니다." });
      await loadAll();
    } finally {
      setBusy(null);
    }
  }

  async function refundPackage(order: PackageOrder) {
    const scenario = packageScenarios[order.scenario];
    if (
      busy
      || !window.confirm(
        `${scenario.refundConfirmation}을 실행합니다. PG 원승인 거래를 확인했습니까?`,
      )
    ) return;
    setBusy(`refund-${order.id}`);
    setNotice(null);
    try {
      const response = await fetch(`/api/payment-test/package-orders/${order.id}/refund`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          confirmation: scenario.refundConfirmation,
        }),
      });
      const body = await responseBody<{ order?: PackageOrder }>(response);
      if (!body.order) throw new PaymentApiError("패키지 테스트 환불 원장을 확인하지 못했습니다.");
      setNotice({ tone: "success", text: `${scenario.label} 전액환불이 확정됐습니다. PG 취소 거래번호를 대조하세요.` });
      await loadAll();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "패키지 테스트 환불에 실패했습니다." });
      await loadAll();
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
        <h1 className="mt-4 text-[28px] font-black tracking-[-.04em] sm:text-[32px]">더페이원 카드·패키지 결제 검증</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-neutral-400">
          기본 정기과금 터미널은 cardId 등록 후 반복 승인하고, 패키지 수기결제 터미널은 카드정보를 저장하지 않은 채 승인마다 /api/pay로 직접 전송합니다.
        </p>
        {notice && (
          <div role={notice.tone === "error" ? "alert" : "status"} className={`mt-5 rounded-xl border p-4 text-sm ${notice.tone === "error" ? "border-red-400/25 bg-red-500/10 text-red-100" : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"}`}>
            {notice.text}
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-white/10 bg-[#191c1e]/90 p-6 sm:p-8">
        <p className="text-xs font-black uppercase tracking-[.18em] text-violet-300">정기과금 등록 + 수기결제 직접 승인</p>
        <h2 className="mt-3 text-2xl font-black">더페이원 테스트 카드정보</h2>
        <p className="mt-3 text-sm leading-7 text-neutral-400">기본 터미널 테스트만 /api/auth로 cardId를 등록합니다. 패키지 버튼은 arti02 수기결제 터미널의 /api/pay에 아래 카드정보를 매번 직접 전달합니다.</p>
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
          <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-white/8 bg-black/15 p-4 text-xs leading-6 text-neutral-300"><input type="checkbox" checked={form.consent} onChange={(event) => update("consent", event.target.checked)} className="mt-1 h-4 w-4 accent-violet-300" /><span>본인 또는 정당한 권한이 있는 카드로 선택한 실제 승인 테스트를 진행하며, 각 패키지 수기결제는 한 번의 명시적 요청으로만 실행되는 데 동의합니다.</span></label>
          <button type="submit" disabled={!cardFormValid || busy !== null} className="sm:col-span-2 min-h-12 rounded-xl bg-violet-300 px-5 text-sm font-black text-violet-950 disabled:cursor-not-allowed disabled:opacity-40">{busy === "register" ? "더페이원 0원 등록 중..." : "기본 터미널 · 0원 등록 후 3분 간격 5회"}</button>
          {(Object.keys(packageScenarios) as PackageScenarioName[]).map((scenarioName) => (
            <button
              key={scenarioName}
              type="button"
              disabled={!cardFormValid || busy !== null}
              onClick={() => void chargePackage(scenarioName)}
              className="min-h-12 rounded-xl bg-[#ff9b8d] px-5 text-sm font-black text-[#36110c] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === `package-${scenarioName}`
                ? "arti02 수기결제 승인 중..."
                : `패키지 직접 승인 · ${packageScenarios[scenarioName].label}`}
            </button>
          ))}
          <p className="sm:col-span-2 text-xs leading-6 text-neutral-500">패키지 수기결제 요청 후 카드번호·유효기간·생년월일·비밀번호 입력값을 즉시 비웁니다. 다음 시나리오는 다시 입력해야 합니다.</p>
          <p className="sm:col-span-2 rounded-xl border border-amber-300/15 bg-amber-400/5 p-4 text-xs leading-6 text-amber-100">
            할부 정상 검증은 신용카드만 가능합니다. 체크카드로 50,000원·3개월 음성 테스트를 하면 정상 결과는 승인 거절입니다. 성공 응답이 오면 권한을 확정하지 않고 카드 유형과 거래번호를 원장에 남겨 전액환불 대상으로 격리합니다.
          </p>
        </form>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[24px] border border-white/10 bg-[#191c1e]/90 p-6">
          <h2 className="text-lg font-black">기본 터미널에 등록된 카드 ID</h2>
          <p className="mt-2 text-xs leading-6 text-neutral-500">arti01 정기과금 반복 테스트에만 사용합니다. 패키지 수기결제에는 이 cardId를 사용하지 않습니다.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_150px]">
            <label className="text-xs font-bold text-neutral-300">승인용 생년월일 / 사업자번호<input inputMode="numeric" value={recurringIdentityNumber} onChange={(event) => setRecurringIdentityNumber(digits(event.target.value, 10))} autoComplete="off" placeholder="6자리 또는 10자리" className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
            <label className="text-xs font-bold text-neutral-300">카드 비밀번호 앞 2자리<input type="password" inputMode="numeric" value={recurringCardPassword} onChange={(event) => setRecurringCardPassword(digits(event.target.value, 2))} autoComplete="off" placeholder="2자리" className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm outline-none focus:border-violet-300/50" /></label>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-neutral-500">더페이원 요청 시에만 사용하며 DB·로그·브라우저 저장소에는 저장하지 않습니다. 새로고침하면 다시 입력해야 합니다.</p>
          <div className="mt-4 space-y-3">
            {loading ? <p className="text-sm text-neutral-500">불러오는 중...</p> : registrations.length === 0 ? <p className="text-sm text-neutral-500">등록된 cardId가 없습니다.</p> : registrations.map((registration) => (
              <article key={registration.id} className="rounded-xl border border-white/8 bg-black/15 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{registration.issuer || "카드"} · •••• {registration.last4 || "----"}</strong><StatusPill danger={registration.status === "unknown"}>{registrationStatus[registration.status]}</StatusPill></div>
                <p className="mt-2 text-xs text-neutral-500">기본 정기과금 터미널 · {dateTime(registration.createdAt)}{registration.resultCode ? ` · ${registration.resultCode}` : ""}</p>
                {registration.terminalId && <p className="mt-1 break-all text-[11px] text-neutral-600">MID {registration.merchantId} · TID {registration.terminalId}</p>}
                {registration.status === "active" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" disabled={busy !== null || digits(form.payerTel, 11).length < 10} onClick={() => void startRecurring(registration)} className="min-h-10 flex-1 rounded-lg bg-violet-300 px-3 text-xs font-black text-violet-950 disabled:opacity-40">{busy === `run-${registration.id}` ? "시작 중..." : "3분 간격 5회 결제"}</button>
                    <button type="button" disabled={busy !== null} onClick={() => void expireBillingKey(registration)} className="min-h-10 rounded-lg border border-white/10 px-3 text-xs font-bold text-neutral-400">폐기</button>
                  </div>
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

      <section className="rounded-[24px] border border-white/10 bg-[#191c1e]/90 p-6 sm:p-8">
        <h2 className="text-lg font-black">패키지 터미널 승인·전액환불 원장</h2>
        <p className="mt-2 text-xs leading-6 text-neutral-500">요청 금액·할부개월과 PG 응답 금액·할부개월·터미널을 함께 저장합니다. unknown 또는 수동 대조 상태는 절대 재승인하지 마세요.</p>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {packageOrders.length === 0 ? (
            <p className="text-sm text-neutral-500">패키지 터미널 테스트 내역이 없습니다.</p>
          ) : packageOrders.map((order) => {
            const review = order.status === "unknown"
              || order.status === "manual_review"
              || order.refundStatus === "unknown"
              || order.refundStatus === "manual_review";
            return (
              <article key={order.id} className="rounded-xl border border-white/8 bg-black/15 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm">{order.label}</strong>
                  <StatusPill danger={review}>{packageOrderStatus[order.status]}</StatusPill>
                </div>
                <dl className="mt-3 grid gap-1 text-xs leading-5 text-neutral-500">
                  <div><dt className="inline text-neutral-400">요청</dt><dd className="inline"> · {won(order.amount)} · {order.installmentMonths ? `${order.installmentMonths}개월` : "일시불"}</dd></div>
                  <div><dt className="inline text-neutral-400">응답</dt><dd className="inline"> · {order.responseAmount === null ? "—" : won(order.responseAmount)} · {order.responseInstallmentMonths === null ? "—" : order.responseInstallmentMonths ? `${order.responseInstallmentMonths}개월` : "일시불"}</dd></div>
                  <div><dt className="inline text-neutral-400">승인 카드</dt><dd className="inline"> · {order.responseIssuer || "—"}{order.responseCardType ? ` · ${order.responseCardType}` : ""}{order.responseCardLast4 ? ` · •••• ${order.responseCardLast4}` : ""}</dd></div>
                  <div><dt className="inline text-neutral-400">승인 거래</dt><dd className="inline break-all"> · {order.transactionId || "—"}</dd></div>
                  <div><dt className="inline text-neutral-400">터미널</dt><dd className="inline break-all"> · {order.terminalId}</dd></div>
                  <div><dt className="inline text-neutral-400">환불</dt><dd className="inline"> · {packageRefundStatus[order.refundStatus]}{order.refundTransactionId ? ` · ${order.refundTransactionId}` : ""}</dd></div>
                </dl>
                {order.failureMessage && <p className="mt-3 rounded-lg bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">{order.failureCode} · {order.failureMessage}</p>}
                {(
                  order.status === "succeeded"
                  || (
                    order.status === "manual_review"
                    && order.failureCode === "INSTALLMENT_CARD_TYPE_NOT_CREDIT"
                  )
                ) && order.refundStatus === "none" && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void refundPackage(order)}
                    className="mt-4 min-h-10 w-full rounded-lg bg-emerald-300 px-3 text-xs font-black text-emerald-950 disabled:opacity-40"
                  >
                    {busy === `refund-${order.id}` ? "전액환불 중..." : `${won(order.amount)} 전액환불`}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="rounded-[20px] border border-amber-300/15 bg-amber-400/[.06] p-5 text-xs leading-6 text-amber-50/80">
        <strong className="block text-amber-100">테스트 종료 후 확인</strong>
        <span className="mt-1 block">기본 정기과금 테스트의 활성 cardId만 반드시 ‘폐기’하세요. 패키지 수기결제는 cardId를 등록하지 않으며, 성공·실패·unknown 거래를 더페이원 관리자에서 trackId로 대조해야 합니다. 결과가 불명확한 요청은 재호출하지 않습니다.</span>
      </section>
    </div>
  );
}
