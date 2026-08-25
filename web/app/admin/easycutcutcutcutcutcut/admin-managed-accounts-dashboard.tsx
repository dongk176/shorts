"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MANAGED_ACCOUNT_TYPE_LABELS,
  type ManagedAccountType,
} from "@/lib/managed-account-type";
import {
  calculateEnterpriseServiceEndDate,
  enterprisePeriodRelation,
  type EnterpriseDurationUnit,
  type EnterpriseVatTreatment,
} from "@/lib/enterprise-contract";
import {
  MANAGED_ACCOUNT_DEFAULT_ACTIVE_JOBS,
  MANAGED_ACCOUNT_MAX_ACTIVE_JOBS,
  MANAGED_ACCOUNT_MIN_ACTIVE_JOBS,
} from "@/lib/managed-account-limits";

export type AdminManagedAccount = {
  id: string;
  userId: string;
  loginId: string;
  accountType: ManagedAccountType;
  displayName: string;
  isActive: boolean;
  maxActiveJobs: number;
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
  paymentMode: string;
  blocksServiceAccess: boolean;
  expiresAt: string;
  createdAt: string;
  items: Array<{
    id: string;
    sortOrder: number;
    name: string;
    amountKrw: number;
    status: string;
    paidAt: string | null;
    serviceStartDate: string | null;
    serviceEndDate: string | null;
    includedMinutes: number | null;
    vatTreatment: string | null;
    paymentDueDate: string | null;
  }>;
};

type EnterpriseProductDraft = {
  key: string;
  name: string;
  serviceStartDate: string;
  durationValue: string;
  durationUnit: EnterpriseDurationUnit;
  includedMinutes: string;
  amountKrw: string;
  vatTreatment: EnterpriseVatTreatment;
  paymentDueDate: string;
};

function kstDate(offsetDays = 0) {
  const date = new Date(Date.now() + 9 * 60 * 60_000);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function newEnterpriseProduct(index: number, key: string): EnterpriseProductDraft {
  return {
    key,
    name: index === 0 ? "EASYCUT 파일럿 이용권" : "",
    serviceStartDate: kstDate(index * 30),
    durationValue: "1",
    durationUnit: "months",
    includedMinutes: "120",
    amountKrw: "",
    vatTreatment: "included",
    paymentDueDate: kstDate(),
  };
}

function productEndDate(product: EnterpriseProductDraft) {
  try {
    return calculateEnterpriseServiceEndDate({
      serviceStartDate: product.serviceStartDate,
      durationValue: Number(product.durationValue),
      durationUnit: product.durationUnit,
    });
  } catch {
    return "";
  }
}

function validEnterpriseProduct(product: EnterpriseProductDraft) {
  const duration = Number(product.durationValue);
  const durationMax = product.durationUnit === "days" ? 3_650 : 120;
  return Boolean(
    product.name.trim()
    && product.serviceStartDate
    && Number.isInteger(duration)
    && duration >= 1
    && duration <= durationMax
    && Number.isInteger(Number(product.includedMinutes))
    && Number(product.includedMinutes) >= 1
    && Number.isInteger(Number(product.amountKrw))
    && Number(product.amountKrw) >= 100
    && product.paymentDueDate
    && productEndDate(product),
  );
}

function enterpriseProductPayload(product: EnterpriseProductDraft) {
  return {
    name: product.name.trim(),
    serviceStartDate: product.serviceStartDate,
    durationValue: Number(product.durationValue),
    durationUnit: product.durationUnit,
    includedMinutes: Number(product.includedMinutes),
    amountKrw: Number(product.amountKrw),
    vatTreatment: product.vatTreatment,
    paymentDueDate: product.paymentDueDate,
  };
}

function EnterpriseProductEditor({
  items,
  onChange,
}: {
  items: EnterpriseProductDraft[];
  onChange: (items: EnterpriseProductDraft[]) => void;
}) {
  function update(index: number, patch: Partial<EnterpriseProductDraft>) {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }
  return (
    <div className="mt-5 grid gap-4">
      {items.map((item, index) => {
        const endDate = productEndDate(item);
        const previousEnd = index > 0 ? productEndDate(items[index - 1]) : "";
        const relation = previousEnd && item.serviceStartDate
          ? enterprisePeriodRelation(
              { serviceEndDate: previousEnd },
              { serviceStartDate: item.serviceStartDate },
            )
          : null;
        const startsBackwards = index > 0
          && item.serviceStartDate < items[index - 1].serviceStartDate;
        return (
          <article key={item.key} className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-black text-white">결제 상품 {index + 1}</h4>
              <div className="flex gap-2">
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)} className="h-8 rounded-lg border border-white/10 px-3 text-xs font-black text-neutral-300 disabled:opacity-30">위로</button>
                <button type="button" disabled={index === items.length - 1} onClick={() => move(index, 1)} className="h-8 rounded-lg border border-white/10 px-3 text-xs font-black text-neutral-300 disabled:opacity-30">아래로</button>
                <button type="button" disabled={items.length === 1} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))} className="h-8 rounded-lg border border-red-300/20 px-3 text-xs font-black text-red-200 disabled:opacity-30">삭제</button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs font-bold text-neutral-400 xl:col-span-2">결제 상품명<input value={item.name} onChange={(event) => update(index, { name: event.target.value })} maxLength={100} placeholder="예: EASYCUT 파일럿 이용권" className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-sky-300/40" /></label>
              <label className="text-xs font-bold text-neutral-400">서비스 시작일<input type="date" value={item.serviceStartDate} onChange={(event) => update(index, { serviceStartDate: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-sky-300/40" /></label>
              <label className="text-xs font-bold text-neutral-400">서비스 종료일<input readOnly value={endDate} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/[.03] px-3 text-sm text-neutral-300" /></label>
              <label className="text-xs font-bold text-neutral-400">이용기간<input type="number" min={1} max={item.durationUnit === "days" ? 3650 : 120} value={item.durationValue} onChange={(event) => update(index, { durationValue: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" /></label>
              <div className="text-xs font-bold text-neutral-400">기간 단위<div className="mt-2 grid h-11 grid-cols-2 rounded-xl border border-white/10 p-1">{(["days", "months"] as const).map((unit) => <button key={unit} type="button" onClick={() => update(index, { durationUnit: unit, durationValue: "1" })} className={`rounded-lg text-xs font-black ${item.durationUnit === unit ? "bg-white text-black" : "text-neutral-400"}`}>{unit === "days" ? "일" : "개월"}</button>)}</div></div>
              <label className="text-xs font-bold text-neutral-400">제공 처리시간(분)<input type="number" min={1} max={100000} value={item.includedMinutes} onChange={(event) => update(index, { includedMinutes: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" /></label>
              <label className="text-xs font-bold text-neutral-400">최종 결제금액(원)<input type="number" min={100} max={1000000000} value={item.amountKrw} onChange={(event) => update(index, { amountKrw: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" /></label>
              <label className="text-xs font-bold text-neutral-400">부가세 표시<select value={item.vatTreatment} onChange={(event) => update(index, { vatTreatment: event.target.value as EnterpriseVatTreatment })} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"><option value="included">부가세 포함</option><option value="not_applicable">부가세 해당 없음</option></select></label>
              <label className="text-xs font-bold text-neutral-400">결제 기한<input type="date" value={item.paymentDueDate} onChange={(event) => update(index, { paymentDueDate: event.target.value })} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" /></label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(item.durationUnit === "days" ? [7, 14, 30, 90] : [1, 3, 6, 12]).map((value) => <button key={value} type="button" onClick={() => update(index, { durationValue: String(value) })} className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-black text-neutral-300">{value}{item.durationUnit === "days" ? "일" : "개월"}</button>)}
            </div>
            {startsBackwards ? <p className="mt-3 text-xs font-bold text-red-200">시작일은 이전 상품의 시작일보다 빠를 수 없습니다.</p> : relation === "overlap" ? <p className="mt-3 text-xs font-bold text-amber-200">이전 상품과 이용기간이 겹칩니다.</p> : relation === "gap" ? <p className="mt-3 text-xs font-bold text-amber-200">이전 상품과 이용기간 사이에 공백이 있습니다.</p> : null}
          </article>
        );
      })}
      <button type="button" disabled={items.length >= 10} onClick={() => onChange([...items, newEnterpriseProduct(items.length, crypto.randomUUID())])} className="h-11 rounded-xl border border-dashed border-white/15 text-sm font-black text-neutral-300 disabled:opacity-30">결제 상품 추가</button>
    </div>
  );
}

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

function EnterprisePaymentRequests({ account }: { account: AdminManagedAccount }) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState(account.displayName);
  const [customerEmail, setCustomerEmail] = useState("");
  const [title, setTitle] = useState("이지컷 기업 결제 요청");
  const [blocksServiceAccess, setBlocksServiceAccess] = useState(false);
  const [items, setItems] = useState<EnterpriseProductDraft[]>([
    newEnterpriseProduct(0, `existing-${account.id}`),
  ]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const validItems = items.length > 0 && items.every(validEnterpriseProduct)
    && items.every((item, index) => index === 0
      || item.serviceStartDate >= items[index - 1].serviceStartDate);

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
          blocksServiceAccess,
          items: items.map(enterpriseProductPayload),
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
            상품별 이용기간과 처리시간을 지정하고, 고객이 등록된 카드로 순서대로 결제합니다.
          </p>
        </div>
        <span className="rounded-full bg-sky-300/10 px-2.5 py-1 text-[11px] font-black text-sky-200">
          빌링결제
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

      <div className="mt-5 grid gap-3 md:grid-cols-3">
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
      </div>
      <EnterpriseProductEditor items={items} onChange={setItems} />

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Toggle checked={blocksServiceAccess} onChange={setBlocksServiceAccess} label="결제 완료 전 서비스 이용 제한" />
        <button
          type="button"
          disabled={creating || !customerName.trim() || !title.trim() || !validItems}
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
  const [maxActiveJobs, setMaxActiveJobs] = useState(String(account.maxActiveJobs));
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
            <span className="rounded-full bg-violet-300/10 px-2.5 py-1 text-[11px] font-black text-violet-200">
              유료 기능 전체 허용
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
          {account.accountType === "personal" ? <label className="mt-3 block text-xs font-bold text-neutral-400">
            서비스 이용 만료
            <input
              type="datetime-local"
              value={serviceUntil}
              onChange={(event) => setServiceUntil(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label> : null}
          <div className="mt-3 grid gap-2">
            <Toggle checked={active} onChange={setActive} label="아이디 로그인 허용" />
          </div>
          <label className="mt-3 block text-xs font-bold text-neutral-400">
            동시 작업 한도
            <input
              type="number"
              min={MANAGED_ACCOUNT_MIN_ACTIVE_JOBS}
              max={MANAGED_ACCOUNT_MAX_ACTIVE_JOBS}
              value={maxActiveJobs}
              onChange={(event) => setMaxActiveJobs(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
            <span className="mt-1.5 block text-[11px] font-normal text-neutral-600">한 계정에서 동시에 처리할 수 있는 프로젝트 수 · 1~10개</span>
          </label>
          <button
            type="button"
            disabled={busy !== null
              || !displayName.trim()
              || !Number.isInteger(Number(maxActiveJobs))
              || Number(maxActiveJobs) < MANAGED_ACCOUNT_MIN_ACTIVE_JOBS
              || Number(maxActiveJobs) > MANAGED_ACCOUNT_MAX_ACTIVE_JOBS}
            onClick={() => void perform("settings", () => send(
              `/api/admin/managed-accounts/${account.id}`,
              "PATCH",
              {
                requestId: crypto.randomUUID(),
                displayName,
                isActive: active,
                maxActiveJobs: Number(maxActiveJobs),
                serviceAccessUntil: account.accountType === "personal"
                  ? requestDate(serviceUntil)
                  : null,
              },
            ), "계정 설정을 저장했습니다.")}
            className="mt-3 h-11 w-full rounded-xl bg-white text-sm font-black text-black transition hover:bg-neutral-200 disabled:opacity-50"
          >
            {busy === "settings" ? "저장 중..." : "설정 저장"}
          </button>
        </section>

        {account.accountType === "personal" ? <section className="rounded-xl border border-white/10 p-4">
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
        </section> : null}

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
  const [maxActiveJobs, setMaxActiveJobs] = useState(String(
    MANAGED_ACCOUNT_DEFAULT_ACTIVE_JOBS,
  ));
  const [customerEmail, setCustomerEmail] = useState("");
  const [paymentTitle, setPaymentTitle] = useState("이지컷 기업 결제 요청");
  const [paymentItems, setPaymentItems] = useState<EnterpriseProductDraft[]>([
    newEnterpriseProduct(0, "new-account-initial"),
  ]);
  const [createdPaymentPath, setCreatedPaymentPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const activeCount = accounts.filter((account) => account.isActive).length;
  const personalCount = accounts.filter((account) => account.accountType === "personal").length;
  const enterpriseCount = accounts.length - personalCount;

  async function createAccount() {
    setCreating(true);
    setMessage("");
    try {
      const response = await send<{ paymentPath?: string | null }>("/api/admin/managed-accounts", "POST", {
        requestId: crypto.randomUUID(),
        loginId,
        temporaryPassword: password,
        displayName,
        accountType,
        maxActiveJobs: Number(maxActiveJobs),
        usageMinutes: accountType === "personal" ? Number(usageMinutes) : 0,
        serviceAccessUntil: accountType === "personal" ? requestDate(serviceUntil) : null,
        customerEmail,
        paymentTitle,
        paymentItems: accountType === "enterprise"
          ? paymentItems.map(enterpriseProductPayload)
          : [],
      });
      setLoginId("");
      setDisplayName("");
      setPassword("");
      setUsageMinutes("120");
      setServiceUntil(defaultExpiry());
      setAccountType("personal");
      setMaxActiveJobs(String(MANAGED_ACCOUNT_DEFAULT_ACTIVE_JOBS));
      setCustomerEmail("");
      setPaymentTitle("이지컷 기업 결제 요청");
      setPaymentItems([newEnterpriseProduct(0, crypto.randomUUID())]);
      setCreatedPaymentPath(response.paymentPath || "");
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

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-7">
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
            동시 작업 한도
            <input
              type="number"
              min={MANAGED_ACCOUNT_MIN_ACTIVE_JOBS}
              max={MANAGED_ACCOUNT_MAX_ACTIVE_JOBS}
              value={maxActiveJobs}
              onChange={(event) => setMaxActiveJobs(event.target.value)}
              className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]/60"
            />
          </label>
          {accountType === "personal" ? <>
            <label className="text-xs font-bold text-neutral-400">
              최초 처리시간(분)
              <input type="number" min={0} max={100_000} value={usageMinutes} onChange={(event) => setUsageMinutes(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]/60" />
            </label>
            <label className="text-xs font-bold text-neutral-400">
              서비스 이용 만료
              <input type="datetime-local" value={serviceUntil} onChange={(event) => setServiceUntil(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#ff8c7c]/60" />
            </label>
          </> : null}
        </div>
        {accountType === "enterprise" ? (
          <section className="mt-5 rounded-2xl border border-sky-300/20 bg-sky-300/[.03] p-4 sm:p-5">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs font-bold text-neutral-400">담당자 이메일(선택)<input type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} maxLength={100} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" /></label>
              <label className="text-xs font-bold text-neutral-400">결제 요청 제목<input value={paymentTitle} onChange={(event) => setPaymentTitle(event.target.value)} maxLength={100} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none" /></label>
            </div>
            <p className="mt-4 text-xs leading-5 text-neutral-500">최초 기업계정은 아래 상품이 모두 결제되어야 하며, 각 상품의 고정된 이용기간에만 서비스를 사용할 수 있습니다.</p>
            <EnterpriseProductEditor items={paymentItems} onChange={setPaymentItems} />
          </section>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-bold leading-5 text-violet-200/80">
            발급 계정은 실시간 인기 필터·템플릿·편집·다운로드 등 유료 기능이 자동으로 허용됩니다.
          </p>
          <button
            type="button"
            disabled={
              creating
              || loginId.length < 3
              || !displayName.trim()
              || password.length < 10
              || !Number.isInteger(Number(maxActiveJobs))
              || Number(maxActiveJobs) < MANAGED_ACCOUNT_MIN_ACTIVE_JOBS
              || Number(maxActiveJobs) > MANAGED_ACCOUNT_MAX_ACTIVE_JOBS
              || (accountType === "personal" && (!serviceUntil || Number(usageMinutes) < 0))
              || (accountType === "enterprise" && (
                !paymentTitle.trim()
                || paymentItems.length < 1
                || !paymentItems.every(validEnterpriseProduct)
                || paymentItems.some((item, index) => index > 0
                  && item.serviceStartDate < paymentItems[index - 1].serviceStartDate)
              ))
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
        {createdPaymentPath ? (
          <button type="button" onClick={() => void navigator.clipboard.writeText(new URL(createdPaymentPath, window.location.origin).toString())} className="mt-3 w-full rounded-xl border border-emerald-300/20 bg-emerald-300/[.08] px-4 py-3 text-left text-xs font-black text-emerald-100 break-all">
            {new URL(createdPaymentPath, window.location.origin).toString()} · 눌러서 복사
          </button>
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
