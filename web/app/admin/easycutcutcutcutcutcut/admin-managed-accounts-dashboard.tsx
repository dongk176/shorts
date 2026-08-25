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

async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { detail?: string };
  if (!response.ok) throw new Error(payload.detail || "요청을 처리하지 못했습니다.");
  return payload;
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
