"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MANAGED_ACCOUNT_TYPE_LABELS,
  type ManagedAccountType,
} from "@/lib/managed-account-type";

export type AdminManagedAccount = {
  id: string;
  userId: string;
  loginId: string;
  accountType: ManagedAccountType;
  displayName: string;
  isActive: boolean;
  popularFilterEnabled: boolean;
  serviceAccessUntil: string | null;
  usageTotalSeconds: number;
  usageConsumedSeconds: number;
  usageReservedSeconds: number;
  usageRemainingSeconds: number;
  projectCount: number;
  shortCount: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastPasswordResetAt: string | null;
  paymentRequests: AdminEnterprisePaymentRequest[];
};

export type AdminEnterprisePaymentRequest = {
  id: string;
  paymentPath: string;
  customerName: string;
  customerEmail: string | null;
  title: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    amountKrw: number;
    status: string;
    paidAt: string | null;
  }>;
};

function defaultExpiry() {
  const value = new Date();
  value.setDate(value.getDate() + 30);
  value.setHours(23, 59, 0, 0);
  return localDateTime(value.toISOString());
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function requestDate(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function date(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function minutes(seconds: number) {
  return Math.max(0, Math.floor(seconds / 60)).toLocaleString("ko-KR");
}

async function send<T = Record<string, unknown>>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { detail?: string };
  if (!response.ok) throw new Error(payload.detail || "요청을 처리하지 못했습니다.");
  return payload as T;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <span className="text-sm font-bold text-neutral-200">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[#ff715e]"
      />
    </label>
  );
}

function won(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function paymentRequestStatus(paymentRequest: AdminEnterprisePaymentRequest) {
  if (paymentRequest.status === "paid") return "전체 결제 완료";
  if (paymentRequest.status === "partial") return "일부 결제 완료";
  if (paymentRequest.status === "canceled") return "요청 취소";
  if (new Date(paymentRequest.expiresAt).getTime() <= Date.now()) return "기한 만료";
  return "결제 대기";
}

function paymentDefaultExpiry() {
  const value = new Date();
  value.setDate(value.getDate() + 14);
  value.setHours(23, 59, 0, 0);
  return localDateTime(value.toISOString());
}

function EnterprisePaymentRequests({ account }: { account: AdminManagedAccount }) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState(account.displayName);
  const [customerEmail, setCustomerEmail] = useState("");
  const [title, setTitle] = useState("이지컷 기업 결제 요청");
  const [expiresAt, setExpiresAt] = useState(paymentDefaultExpiry);
  const [items, setItems] = useState([
    { name: "", amount: "" },
    { name: "", amount: "" },
  ]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const validItems = items.every((item) => (
    item.name.trim().length > 0
    && Number.isInteger(Number(item.amount))
    && Number(item.amount) >= 100
  ));

  async function copyPaymentLink(pathOrUrl: string) {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : new URL(pathOrUrl, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setMessage("결제 링크를 복사했습니다.");
    } catch {
      setMessage(`결제 링크: ${url}`);
    }
  }

  async function createPaymentRequest() {
    setCreating(true);
    setMessage("");
    setCreatedUrl("");
    try {
      const response = await send<{ paymentUrl: string }>(
        `/api/admin/managed-accounts/${account.id}/payment-requests`,
        "POST",
        {
          requestId: crypto.randomUUID(),
          customerName,
          customerEmail,
          title,
          expiresAt: requestDate(expiresAt),
          items: items.map((item) => ({
            name: item.name.trim(),
            amountKrw: Number(item.amount),
          })),
        },
      );
      setCreatedUrl(response.paymentUrl);
      setMessage("결제 요청을 만들었습니다. 아래 링크를 기업 담당자에게 전달해 주세요.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "결제 요청을 만들지 못했습니다.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-sky-300/20 bg-sky-300/[.04] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-black text-sky-100">기업 결제 요청</h4>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            여러 결제 항목을 한 링크에 담아 보내고, 각 항목의 카드 승인 상태를 따로 확인합니다.
          </p>
        </div>
        <span className="rounded-full bg-sky-300/10 px-2.5 py-1 text-[11px] font-black text-sky-200">
          일반결제
        </span>
      </div>

      {account.paymentRequests.length ? (
        <div className="mt-4 grid gap-2">
          {account.paymentRequests.map((paymentRequest) => {
            const total = paymentRequest.items.reduce((sum, item) => sum + item.amountKrw, 0);
            const paid = paymentRequest.items
              .filter((item) => item.status === "paid")
              .reduce((sum, item) => sum + item.amountKrw, 0);
            return (
              <div key={paymentRequest.id} className="rounded-xl border border-white/10 bg-black/20 p-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <p className="text-xs font-black text-white">{paymentRequest.title}</p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {paymentRequestStatus(paymentRequest)} · {won(paid)} / {won(total)} · 기한 {date(paymentRequest.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyPaymentLink(paymentRequest.paymentPath)}
                  className="mt-3 h-9 rounded-lg border border-white/10 px-3 text-xs font-black text-neutral-200 hover:bg-white/[.05] sm:mt-0"
                >
                  링크 복사
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-xs font-bold text-neutral-400">
          결제 담당 기업·이름
          <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={100} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-sky-300/40" />
        </label>
        <label className="text-xs font-bold text-neutral-400">
          담당자 이메일(선택)
          <input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} maxLength={100} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-sky-300/40" />
        </label>
        <label className="text-xs font-bold text-neutral-400">
          요청 제목
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-sky-300/40" />
        </label>
        <label className="text-xs font-bold text-neutral-400">
          결제 기한
          <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-sky-300/40" />
        </label>
      </div>

      <div className="mt-4 grid gap-2">
        {items.map((item, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
            <input
              value={item.name}
              onChange={(event) => setItems((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, name: event.target.value } : candidate))}
              maxLength={100}
              placeholder={index === 0 ? "예: 파일럿 이용료" : "예: 정규 이용료"}
              aria-label={`결제 ${index + 1} 항목명`}
              className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-sky-300/40"
            />
            <input
              type="number"
              min={100}
              max={1_000_000_000}
              value={item.amount}
              onChange={(event) => setItems((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, amount: event.target.value } : candidate))}
              placeholder="결제 금액(원)"
              aria-label={`결제 ${index + 1} 금액`}
              className="h-11 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-sky-300/40"
            />
            <button
              type="button"
              disabled={items.length === 1}
              onClick={() => setItems((current) => current.filter((_, candidateIndex) => candidateIndex !== index))}
              className="h-11 rounded-xl border border-white/10 px-3 text-xs font-black text-neutral-400 disabled:opacity-30"
            >
              삭제
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-between">
        <button
          type="button"
          disabled={items.length >= 10}
          onClick={() => setItems((current) => [...current, { name: "", amount: "" }])}
          className="h-10 rounded-xl border border-white/10 px-4 text-xs font-black text-neutral-300 disabled:opacity-30"
        >
          결제 항목 추가
        </button>
        <button
          type="button"
          disabled={creating || !customerName.trim() || !title.trim() || !expiresAt || !validItems}
          onClick={() => void createPaymentRequest()}
          className="h-11 rounded-xl bg-sky-300 px-5 text-sm font-black text-sky-950 disabled:opacity-40"
        >
          {creating ? "요청 만드는 중..." : "결제 요청 만들기"}
        </button>
      </div>
      {createdUrl ? (
        <button type="button" onClick={() => void copyPaymentLink(createdUrl)} className="mt-3 w-full rounded-xl border border-emerald-300/20 bg-emerald-300/[.08] px-4 py-3 text-left text-xs font-black text-emerald-100 break-all">
          {createdUrl} · 눌러서 복사
        </button>
      ) : null}
      {message ? <p className="mt-3 text-xs leading-5 text-neutral-300" role="status">{message}</p> : null}
    </section>
  );
}

function ManagedAccountCard({ account }: { account: AdminManagedAccount }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [active, setActive] = useState(account.isActive);
  const [filterEnabled, setFilterEnabled] = useState(account.popularFilterEnabled);
  const [serviceUntil, setServiceUntil] = useState(localDateTime(account.serviceAccessUntil));
  const [usageMinutes, setUsageMinutes] = useState("60");
  const [usageUntil, setUsageUntil] = useState(
    localDateTime(account.serviceAccessUntil) || defaultExpiry(),
  );
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"settings" | "usage" | "password" | null>(null);
  const [message, setMessage] = useState("");
  const usagePercent = account.usageTotalSeconds > 0
    ? Math.min(100, Math.round(
      (account.usageConsumedSeconds + account.usageReservedSeconds)
        / account.usageTotalSeconds * 100,
    ))
    : 0;

  async function perform(
    kind: NonNullable<typeof busy>,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(kind);
    setMessage("");
    try {
      await action();
      if (kind === "password") setPassword("");
      setMessage(success);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-2xl border border-white/10 bg-[#16191a] p-5 shadow-[0_18px_50px_rgba(0,0,0,.16)] sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-lg font-black text-white">{account.loginId}</h3>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
              account.accountType === "enterprise"
                ? "bg-sky-300/10 text-sky-200"
                : "bg-white/[.05] text-neutral-300"
            }`}>
              {MANAGED_ACCOUNT_TYPE_LABELS[account.accountType]}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
              account.isActive
                ? "bg-emerald-300/10 text-emerald-200"
                : "bg-red-300/10 text-red-200"
            }`}>
              {account.isActive ? "로그인 허용" : "로그인 차단"}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
              account.popularFilterEnabled
                ? "bg-violet-300/10 text-violet-200"
                : "bg-white/[.05] text-neutral-500"
            }`}>
              필터 {account.popularFilterEnabled ? "허용" : "차단"}
            </span>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            최근 로그인 {date(account.lastLoginAt)} · 생성 {date(account.createdAt)}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center text-xs lg:min-w-56">
          <div className="rounded-xl bg-black/20 px-3 py-2.5">
            <p className="text-neutral-500">프로젝트</p>
            <p className="mt-1 font-black text-white">{account.projectCount.toLocaleString("ko-KR")}</p>
          </div>
          <div className="rounded-xl bg-black/20 px-3 py-2.5">
            <p className="text-neutral-500">완성 쇼츠</p>
            <p className="mt-1 font-black text-white">{account.shortCount.toLocaleString("ko-KR")}</p>
          </div>
        </div>
      </div>

      <section className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-neutral-500">현재 사용량</p>
            <p className="mt-1 text-xl font-black text-white">
              잔여 {minutes(account.usageRemainingSeconds)}분
            </p>
          </div>
          <p className="text-xs text-neutral-400">
            사용 {minutes(account.usageConsumedSeconds)}분 · 예약 {minutes(account.usageReservedSeconds)}분
            {" · "}총 {minutes(account.usageTotalSeconds)}분
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#ff715e] to-[#ff9b8d]"
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-neutral-600">
          서비스 이용 만료 {date(account.serviceAccessUntil)}
        </p>
      </section>

      {account.accountType === "enterprise" ? (
        <EnterprisePaymentRequests account={account} />
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <section className="rounded-xl border border-white/10 p-4">
          <h4 className="text-sm font-black text-white">계정·권한</h4>
          <label className="mt-3 block text-xs font-bold text-neutral-400">
            표시 이름
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={100}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <label className="mt-3 block text-xs font-bold text-neutral-400">
            서비스 이용 만료
            <input
              type="datetime-local"
              value={serviceUntil}
              onChange={(event) => setServiceUntil(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <div className="mt-3 grid gap-2">
            <Toggle checked={active} onChange={setActive} label="아이디 로그인 허용" />
            <Toggle checked={filterEnabled} onChange={setFilterEnabled} label="실시간 인기 필터 허용" />
          </div>
          <button
            type="button"
            disabled={busy !== null || !displayName.trim()}
            onClick={() => void perform("settings", () => send(
              `/api/admin/managed-accounts/${account.id}`,
              "PATCH",
              {
                requestId: crypto.randomUUID(),
                displayName,
                isActive: active,
                popularFilterEnabled: filterEnabled,
                serviceAccessUntil: requestDate(serviceUntil),
              },
            ), "계정 설정을 저장했습니다.")}
            className="mt-3 h-11 w-full rounded-xl bg-white text-sm font-black text-black transition hover:bg-neutral-200 disabled:opacity-50"
          >
            {busy === "settings" ? "저장 중..." : "설정 저장"}
          </button>
        </section>

        <section className="rounded-xl border border-white/10 p-4">
          <h4 className="text-sm font-black text-white">처리시간 추가</h4>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            기존 사용 내역은 유지하고 새 무료 처리시간을 추가합니다.
          </p>
          <label className="mt-3 block text-xs font-bold text-neutral-400">
            추가 시간(분)
            <input
              type="number"
              min={1}
              max={100_000}
              value={usageMinutes}
              onChange={(event) => setUsageMinutes(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <label className="mt-3 block text-xs font-bold text-neutral-400">
            추가분 만료일
            <input
              type="datetime-local"
              value={usageUntil}
              onChange={(event) => setUsageUntil(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <button
            type="button"
            disabled={busy !== null || Number(usageMinutes) < 1 || !usageUntil}
            onClick={() => void perform("usage", () => send(
              `/api/admin/managed-accounts/${account.id}/usage`,
              "POST",
              {
                requestId: crypto.randomUUID(),
                minutes: Number(usageMinutes),
                validUntil: requestDate(usageUntil),
              },
            ), `${Number(usageMinutes).toLocaleString("ko-KR")}분을 추가했습니다.`)}
            className="mt-3 h-11 w-full rounded-xl border border-emerald-300/20 bg-emerald-300/10 text-sm font-black text-emerald-100 transition hover:bg-emerald-300/15 disabled:opacity-50"
          >
            {busy === "usage" ? "추가 중..." : "처리시간 추가"}
          </button>
        </section>

        <section className="rounded-xl border border-white/10 p-4">
          <h4 className="text-sm font-black text-white">비밀번호 재설정</h4>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            기존 비밀번호는 조회할 수 없습니다. 새 임시 비밀번호만 설정할 수 있습니다.
          </p>
          <label className="mt-3 block text-xs font-bold text-neutral-400">
            새 임시 비밀번호
            <input
              type="password"
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="10자 이상"
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <p className="mt-3 text-[11px] text-neutral-600">
            마지막 재설정 {date(account.lastPasswordResetAt)}
          </p>
          <button
            type="button"
            disabled={busy !== null || password.length < 10}
            onClick={() => void perform("password", () => send(
              `/api/admin/managed-accounts/${account.id}/password`,
              "POST",
              { requestId: crypto.randomUUID(), temporaryPassword: password },
            ), "새 임시 비밀번호를 설정했습니다.")}
            className="mt-3 h-11 w-full rounded-xl border border-amber-300/20 bg-amber-300/10 text-sm font-black text-amber-100 transition hover:bg-amber-300/15 disabled:opacity-50"
          >
            {busy === "password" ? "설정 중..." : "임시 비밀번호 설정"}
          </button>
        </section>
      </div>
      {message ? (
        <p className="mt-4 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm text-neutral-200" role="status">
          {message}
        </p>
      ) : null}
    </article>
  );
}

export function AdminManagedAccountsDashboard({
  accounts,
}: {
  accounts: AdminManagedAccount[];
}) {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [usageMinutes, setUsageMinutes] = useState("120");
  const [serviceUntil, setServiceUntil] = useState(defaultExpiry);
  const [accountType, setAccountType] = useState<ManagedAccountType>("personal");
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const activeCount = accounts.filter((account) => account.isActive).length;
  const personalCount = accounts.filter((account) => account.accountType === "personal").length;
  const enterpriseCount = accounts.length - personalCount;

  async function createAccount() {
    setCreating(true);
    setMessage("");
    try {
      await send("/api/admin/managed-accounts", "POST", {
        requestId: crypto.randomUUID(),
        loginId,
        temporaryPassword: password,
        displayName,
        accountType,
        usageMinutes: Number(usageMinutes),
        serviceAccessUntil: requestDate(serviceUntil),
        popularFilterEnabled: filterEnabled,
      });
      setLoginId("");
      setDisplayName("");
      setPassword("");
      setUsageMinutes("120");
      setServiceUntil(defaultExpiry());
      setAccountType("personal");
      setFilterEnabled(false);
      setMessage("발급 계정을 만들었습니다. 임시 비밀번호는 지금 안전하게 전달해 주세요.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "발급 계정을 만들지 못했습니다.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mt-7 grid gap-6">
      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff9585]">Invite only</p>
            <h2 className="mt-2 text-2xl font-black text-white">아이디·비밀번호 계정 발급</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
              여기서 만든 계정만 아이디로 로그인할 수 있습니다. 비밀번호 원문은 저장하거나 다시 보여주지 않습니다.
            </p>
          </div>
          <div className="rounded-xl bg-black/20 px-4 py-3 text-right">
            <p className="text-xs text-neutral-500">전체 / 활성</p>
            <p className="mt-1 text-lg font-black text-white">{accounts.length} / {activeCount}</p>
            <p className="mt-1 text-[11px] text-neutral-500">
              개인 {personalCount} · 기업 {enterpriseCount}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <label className="text-xs font-bold text-neutral-400">
            계정 구분
            <select
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as ManagedAccountType)}
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm font-bold text-white outline-none focus:border-[#ff8c7c]/60"
            >
              <option value="personal">개인</option>
              <option value="enterprise">기업</option>
            </select>
          </label>
          <label className="text-xs font-bold text-neutral-400">
            로그인 아이디
            <input
              value={loginId}
              onChange={(event) => setLoginId(event.target.value.toLowerCase())}
              minLength={3}
              maxLength={32}
              autoComplete="off"
              placeholder="creator01"
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 font-mono text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <label className="text-xs font-bold text-neutral-400">
            표시 이름
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={100}
              placeholder="홍길동"
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <label className="text-xs font-bold text-neutral-400">
            임시 비밀번호
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              placeholder="10자 이상"
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <label className="text-xs font-bold text-neutral-400">
            최초 처리시간(분)
            <input
              type="number"
              min={0}
              max={100_000}
              value={usageMinutes}
              onChange={(event) => setUsageMinutes(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          <label className="text-xs font-bold text-neutral-400">
            서비스 이용 만료
            <input
              type="datetime-local"
              value={serviceUntil}
              onChange={(event) => setServiceUntil(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Toggle checked={filterEnabled} onChange={setFilterEnabled} label="실시간 인기 필터도 허용" />
          <button
            type="button"
            disabled={
              creating
              || loginId.length < 3
              || !displayName.trim()
              || password.length < 10
              || !serviceUntil
              || Number(usageMinutes) < 0
            }
            onClick={() => void createAccount()}
            className="h-12 rounded-xl bg-[#ff715e] px-7 text-sm font-black text-white shadow-[0_10px_30px_rgba(255,113,94,.18)] transition hover:bg-[#ff806f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? "발급 중..." : "계정 발급"}
          </button>
        </div>
        {message ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm text-neutral-200" role="status">
            {message}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4" aria-label="발급 계정 목록">
        {accounts.map((account) => (
          <ManagedAccountCard key={account.id} account={account} />
        ))}
        {!accounts.length ? (
          <div className="rounded-2xl border border-dashed border-white/15 px-6 py-16 text-center text-sm text-neutral-500">
            아직 발급한 계정이 없습니다.
          </div>
        ) : null}
      </section>
    </div>
  );
}
