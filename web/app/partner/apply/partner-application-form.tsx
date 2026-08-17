"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import {
  PARTNER_APPLICATION_CONSENT_VERSION,
  partnerApplicationAudienceLabels,
  partnerApplicationAudienceSizes,
  partnerApplicationChannelLabels,
  partnerApplicationChannelTypes,
  partnerApplicationIncomeGoals,
  partnerApplicationIncomeLabels,
  type PartnerApplicationChannelType,
} from "@/lib/partner-application";

const channelOptions = partnerApplicationChannelTypes.map((value) => ({
  value,
  label: partnerApplicationChannelLabels[value],
}));
const audienceOptions = partnerApplicationAudienceSizes.map((value) => ({
  value,
  label: partnerApplicationAudienceLabels[value],
}));
const incomeOptions = [
  { value: partnerApplicationIncomeGoals[0], amount: partnerApplicationIncomeLabels.under_100, description: "부수입부터 가볍게" },
  { value: partnerApplicationIncomeGoals[1], amount: partnerApplicationIncomeLabels.over_300, description: "꾸준한 수익 채널로" },
  { value: partnerApplicationIncomeGoals[2], amount: partnerApplicationIncomeLabels.over_1000, description: "본격적인 파트너 활동" },
];

export function PartnerApplicationForm() {
  const [channelTypes, setChannelTypes] = useState<PartnerApplicationChannelType[]>([]);
  const [receipt, setReceipt] = useState<{ referenceCode: string; alreadySubmitted: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  function toggleChannel(channel: PartnerApplicationChannelType) {
    setChannelTypes((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    const data = new FormData(event.currentTarget);
    requestIdRef.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/partner/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          requestId: requestIdRef.current,
          displayName: data.get("displayName"),
          email: data.get("email"),
          phone: data.get("phone"),
          channelTypes,
          channelUrl: data.get("channelUrl"),
          audienceSize: data.get("audienceSize"),
          promotionPlan: data.get("promotionPlan"),
          incomeGoal: data.get("incomeGoal"),
          disclosureAgreed: data.get("disclosureAgreed") === "on",
          antiAbuseAgreed: data.get("antiAbuseAgreed") === "on",
          privacyAgreed: data.get("privacyAgreed") === "on",
          consentVersion: PARTNER_APPLICATION_CONSENT_VERSION,
        }),
      });
      const result = await response.json() as {
        detail?: string;
        referenceCode?: string;
        alreadySubmitted?: boolean;
      };
      if (!response.ok || !result.referenceCode) {
        throw new Error(result.detail || "신청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      setReceipt({
        referenceCode: result.referenceCode,
        alreadySubmitted: Boolean(result.alreadySubmitted),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setErrorMessage(error instanceof Error
        ? error.message
        : "신청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <div className="overflow-hidden rounded-[26px] border border-white/[.1] bg-[#171a1c]/95 shadow-[0_30px_100px_rgba(0,0,0,.35)]">
        <div className="border-b border-emerald-300/15 bg-gradient-to-r from-emerald-400/10 via-transparent to-[#a078ff]/10 px-6 py-3 text-center text-[11px] font-bold text-emerald-200">
          EASYCUT PARTNER · 신청 접수 완료
        </div>
        <div className="px-6 py-16 text-center sm:px-10 sm:py-20">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-[#ff9585]/20 bg-[#ff715e]/10 text-[#ff9f91] shadow-[0_0_50px_rgba(255,113,94,.12)]">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden="true">
              <path d="m6.5 12.5 3.4 3.3 7.6-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="mt-6 text-xs font-black tracking-[.14em] text-[#ff9585]">EASYCUT PARTNER</p>
          <h3 className="mt-3 text-2xl font-black tracking-[-.04em]">
            {receipt.alreadySubmitted ? "이미 접수된 신청이 있어요" : "파트너 신청이 접수됐어요"}
          </h3>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-neutral-500">
            담당자가 내용을 확인한 뒤 입력하신 이메일 또는 전화번호로 안내드리겠습니다.
          </p>
          <div className="mx-auto mt-6 max-w-xs rounded-xl border border-white/[.08] bg-black/20 px-4 py-3">
            <p className="text-[10px] font-black tracking-[.12em] text-neutral-600">접수번호</p>
            <p className="mt-1.5 font-mono text-sm font-black tracking-[.08em] text-neutral-200">{receipt.referenceCode}</p>
          </div>
          <Link
            href="/"
            className="mt-8 inline-flex min-h-12 items-center rounded-xl border border-white/[.12] bg-white/[.04] px-6 text-sm font-black text-neutral-200 transition hover:border-white/25 hover:bg-white/[.07]"
          >
            이지컷 홈으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="overflow-hidden rounded-[26px] border border-white/[.1] bg-[#171a1c]/95 shadow-[0_30px_100px_rgba(0,0,0,.35)]"
    >
      <div className="border-b border-[#ff9585]/15 bg-gradient-to-r from-[#ff715e]/10 via-transparent to-[#a078ff]/10 px-5 py-3 text-center text-[11px] font-bold text-[#ffb1a5] sm:px-8">
        신청 내용은 파트너 선정 검토 및 운영 연락에만 사용됩니다
      </div>

      <div className="divide-y divide-white/[.07]">
        <FormSection number="01" title="이름 또는 활동명을 알려주세요." required>
          <input
            required
            name="displayName"
            type="text"
            autoComplete="name"
            placeholder="예: 김이지 / 쇼츠연구소"
            className={inputClassName}
          />
        </FormSection>

        <FormSection number="02" title="이지컷 가입 이메일을 입력해주세요." required>
          <input
            required
            name="email"
            type="email"
            autoComplete="email"
            placeholder="easycut@example.com"
            className={inputClassName}
          />
          <p className="mt-2 text-[11px] leading-5 text-neutral-600">파트너 선정 안내와 혜택 적용에 사용합니다.</p>
        </FormSection>

        <FormSection number="03" title="연락 가능한 전화번호를 입력해주세요." required>
          <input
            required
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            placeholder="010-1234-5678"
            pattern="[0-9+() -]{8,20}"
            className={inputClassName}
          />
          <p className="mt-2 text-[11px] leading-5 text-neutral-600">선정 및 활동 안내가 필요한 경우에만 연락드립니다.</p>
        </FormSection>

        <FormSection number="04" title="어떤 채널을 운영하고 있나요?" description="복수 선택 가능" required>
          <div className="flex flex-wrap gap-2">
            {channelOptions.map((channel) => {
              const checked = channelTypes.includes(channel.value);
              return (
                <label
                  key={channel.value}
                  className={`cursor-pointer rounded-full border px-4 py-2.5 text-xs font-bold transition ${
                    checked
                      ? "border-[#ff9585]/55 bg-[#ff715e]/15 text-[#ffb1a5] shadow-[0_0_0_1px_rgba(255,113,94,.08)]"
                      : "border-white/[.1] bg-black/15 text-neutral-400 hover:border-white/20 hover:text-neutral-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="channelTypes"
                    value={channel.value}
                    checked={checked}
                    required={channelTypes.length === 0}
                    onChange={() => toggleChannel(channel.value)}
                    className="sr-only"
                  />
                  {channel.label}
                </label>
              );
            })}
          </div>
        </FormSection>

        <FormSection number="05" title="대표 채널 또는 커뮤니티 주소를 남겨주세요." required>
          <input
            required
            name="channelUrl"
            type="url"
            inputMode="url"
            placeholder="https://"
            className={inputClassName}
          />
          <p className="mt-2 text-[11px] leading-5 text-neutral-600">가장 활발하게 운영 중인 링크 하나면 충분합니다.</p>
        </FormSection>

        <FormSection number="06" title="채널 규모는 어느 정도인가요?" required>
          <select required name="audienceSize" defaultValue="" className={`${inputClassName} appearance-none`}>
            <option value="" disabled>구독자·팔로워·회원 수를 선택해주세요</option>
            {audienceOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </FormSection>

        <FormSection
          number="07"
          title="이지컷을 어떻게 소개해보고 싶나요?"
          description="소개할 대상과 채널, 홍보 방식을 간단히 적어주세요."
          required
        >
          <textarea
            required
            name="promotionPlan"
            rows={5}
            maxLength={500}
            placeholder="예: 영상 제작에 관심 있는 유튜브 구독자에게 실제 사용 후기를 쇼츠와 커뮤니티 글로 소개하고 싶습니다."
            className={`${inputClassName} min-h-32 resize-y py-3.5 leading-6`}
          />
        </FormSection>

        <FormSection number="08" title="파트너 활동으로 원하는 월 수익은 얼마인가요?" required>
          <div className="grid gap-2 sm:grid-cols-3">
            {incomeOptions.map((option) => (
              <label key={option.value} className="group relative cursor-pointer">
                <input
                  required
                  type="radio"
                  name="incomeGoal"
                  value={option.value}
                  className="peer sr-only"
                />
                <span className="block min-h-[92px] rounded-2xl border border-white/[.1] bg-black/15 p-4 transition group-hover:border-white/20 peer-checked:border-[#b89aff]/60 peer-checked:bg-[#a078ff]/10 peer-checked:shadow-[0_0_0_1px_rgba(160,120,255,.08)]">
                  <span className="block text-[13px] font-black text-neutral-200 peer-checked:text-white">{option.amount}</span>
                  <span className="mt-2 block text-[10px] leading-4 text-neutral-600">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-5 text-neutral-600">
            목표 확인을 위한 항목이며, 선택한 금액의 수익을 보장하지 않습니다.
          </p>
        </FormSection>

        <FormSection number="09" title="파트너 운영 원칙을 확인해주세요." required>
          <div className="space-y-2.5">
            <ConsentCheckbox name="disclosureAgreed">
              콘텐츠에 이지컷과의 추천·제휴 관계를 명확하게 표시하겠습니다.
            </ConsentCheckbox>
            <ConsentCheckbox name="antiAbuseAgreed">
              허위·과장 홍보, 스팸, 자기추천, 부정 결제를 하지 않겠습니다.
            </ConsentCheckbox>
            <ConsentCheckbox name="privacyAgreed">
              파트너 심사·운영 연락을 위한 개인정보 수집·이용에 동의합니다.
            </ConsentCheckbox>
          </div>
          <div className="mt-3 rounded-xl border border-white/[.06] bg-black/10 px-3.5 py-3 text-[11px] leading-5 text-neutral-600">
            <p>수집 항목: 이름·활동명, 이메일, 전화번호, 채널 정보, 활동 계획, 수익 목표</p>
            <p>이용 목적: 지원자 심사, 선정 안내, 파트너 운영 연락</p>
            <p>보유 기간: 모집·운영 목적 달성 후 지체 없이 파기</p>
            <p className="mt-1.5">
              <Link href="/partner/terms" target="_blank" className="font-bold text-neutral-400 underline underline-offset-4 hover:text-neutral-200">파트너 운영 약관</Link>
              <span aria-hidden="true"> · </span>
              <Link href="/privacy" target="_blank" className="font-bold text-neutral-400 underline underline-offset-4 hover:text-neutral-200">개인정보처리방침</Link>
            </p>
          </div>
        </FormSection>
      </div>

      <div className="bg-black/20 px-5 py-6 sm:px-8 sm:py-8">
        {errorMessage ? (
          <p role="alert" className="mb-4 rounded-xl border border-red-300/15 bg-red-400/[.07] px-4 py-3 text-center text-xs font-bold leading-5 text-red-200">
            {errorMessage}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#ee5d4a] via-[#ff715e] to-[#f06e61] px-6 text-sm font-black text-white shadow-[0_16px_36px_rgba(240,68,53,.2)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(240,68,53,.3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#ff9585] disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {submitting ? "신청을 접수하고 있어요…" : "EASYCUT PARTNER 1기 신청하기"}
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
            <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <p className="mt-4 text-center text-[11px] leading-5 text-neutral-600">
          선정된 분께만 정산 정보 등 다음 절차를 별도로 안내드립니다.
        </p>
      </div>
    </form>
  );
}

function FormSection({
  number,
  title,
  description,
  required = false,
  children,
}: {
  number: string;
  title: string;
  description?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="px-5 py-7 sm:px-8 sm:py-8">
      <legend className="sr-only">{title}</legend>
      <div className="mb-4 flex items-start gap-3">
        <span className="pt-0.5 text-[10px] font-black tracking-[.1em] text-[#ff9585]">{number}</span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-black leading-6 tracking-[-.025em] text-neutral-100">{title}</p>
            {required ? <span className="text-[9px] font-black text-[#ff9585]">필수</span> : null}
          </div>
          {description ? <p className="mt-1 text-[11px] leading-5 text-neutral-600">{description}</p> : null}
        </div>
      </div>
      <div className="pl-0 sm:pl-7">{children}</div>
    </fieldset>
  );
}

function ConsentCheckbox({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <label className="group flex cursor-pointer items-start gap-3 rounded-xl border border-white/[.07] bg-black/10 px-3.5 py-3 transition hover:border-white/[.13]">
      <input
        required
        type="checkbox"
        name={name}
        className="peer mt-0.5 h-4 w-4 flex-none appearance-none rounded border border-white/20 bg-black/20 transition checked:border-[#ff715e] checked:bg-[#ff715e] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9585]"
      />
      <span className="text-xs leading-5 text-neutral-500 transition peer-checked:text-neutral-300">{children}</span>
    </label>
  );
}

const inputClassName =
  "min-h-12 w-full rounded-xl border border-white/[.1] bg-[#101315] px-4 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-700 hover:border-white/[.16] focus:border-[#ff9585]/55 focus:ring-4 focus:ring-[#ff715e]/[.07]";
