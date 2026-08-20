"use client";

import { useState } from "react";
import {
  TOSS_RUNTIME_ASSIGNMENTS_FLAG,
  TOSS_RUNTIME_CHARGES_FLAG,
  TOSS_RUNTIME_RENEWALS_FLAG,
  type TossBillingRuntimeState,
  type TossRuntimeFlag,
} from "@/lib/toss-billing-runtime-contract";
import { updateTossBillingRuntimeSetting } from "./toss-billing-runtime-actions";

const controls: Array<{
  flag: TossRuntimeFlag;
  key: keyof TossBillingRuntimeState["stored"];
  title: string;
  description: string;
}> = [
  {
    flag: TOSS_RUNTIME_ASSIGNMENTS_FLAG,
    key: "assignments",
    title: "신규 토스 사용자 배정",
    description: "결제·구독·결제수단 흔적이 없는 회원이 요금제 페이지를 방문할 때 토스 결제군으로 고정됩니다.",
  },
  {
    flag: TOSS_RUNTIME_CHARGES_FLAG,
    key: "charges",
    title: "토스 신규 승인",
    description: "구독 시작·요금제 변경·추가상품의 새 승인을 제어합니다. OFF여도 결제 결과 확인과 환불은 계속됩니다.",
  },
  {
    flag: TOSS_RUNTIME_RENEWALS_FLAG,
    key: "renewals",
    title: "토스 자동갱신",
    description: "계약 만료일에 저장된 결제수단으로 다음 계약을 자동 승인합니다.",
  },
];

export function AdminTossBillingSettings({
  initialState,
}: {
  initialState: TossBillingRuntimeState;
}) {
  const [state, setState] = useState(initialState);
  const [saving, setSaving] = useState<TossRuntimeFlag | null>(null);
  const [message, setMessage] = useState("");

  const change = async (control: typeof controls[number]) => {
    if (saving) return;
    const next = !state.stored[control.key];
    const warning = control.flag === TOSS_RUNTIME_CHARGES_FLAG && !next
      ? "신규 승인과 함께 신규 배정·자동갱신도 즉시 중단됩니다. 계속할까요?"
      : control.flag === TOSS_RUNTIME_ASSIGNMENTS_FLAG && next
        ? "대상 회원이 요금제 페이지를 방문하면 토스 결제군으로 영구 고정됩니다. 공개를 시작할까요?"
        : `${control.title}을(를) ${next ? "켤까요" : "끌까요"}?`;
    if (!window.confirm(warning)) return;
    setSaving(control.flag);
    setMessage("");
    try {
      const updated = await updateTossBillingRuntimeSetting({
        flag: control.flag,
        enabled: next,
      });
      setState(updated);
      setMessage(`${control.title} 설정을 변경했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "설정을 변경하지 못했습니다.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="mt-7 rounded-2xl border border-white/10 bg-[#151819] p-5 sm:p-7">
      <div>
        <p className="text-xs font-black uppercase tracking-[.18em] text-[#ff8b7e]">Toss Billing Safety</p>
        <h2 className="mt-2 text-xl font-black text-white">토스 결제 긴급 스위치</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
          배포 없이 즉시 적용됩니다. 배포 환경 스위치와 이 운영 스위치가 모두 ON일 때만 실제로 동작합니다.
        </p>
      </div>
      <div className="mt-6 grid gap-3">
        {controls.map((control) => {
          const storedEnabled = state.stored[control.key];
          const environmentEnabled = state.environment[control.key];
          const effectiveEnabled = state.effective[control.key];
          return (
            <div key={control.flag} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-black text-white">{control.title}</h3>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
                    effectiveEnabled
                      ? "bg-emerald-300/10 text-emerald-200"
                      : "bg-red-300/10 text-red-200"
                  }`}>
                    {effectiveEnabled ? "ON" : "OFF"}
                  </span>
                  {!environmentEnabled ? (
                    <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[11px] font-black text-amber-100">
                      배포 설정 OFF
                    </span>
                  ) : null}
                </div>
                <p id={`${control.flag}-description`} className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">
                  {control.description}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={storedEnabled}
                aria-describedby={`${control.flag}-description`}
                disabled={Boolean(saving) || (!environmentEnabled && !storedEnabled)}
                onClick={() => void change(control)}
                className={`relative h-10 w-[72px] shrink-0 rounded-full border p-1 transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  storedEnabled
                    ? "border-emerald-300/50 bg-emerald-400/30"
                    : "border-white/15 bg-black/30"
                }`}
              >
                <span aria-hidden="true" className={`block h-8 w-8 rounded-full bg-white shadow-lg transition-transform ${storedEnabled ? "translate-x-8" : "translate-x-0"}`} />
              </button>
            </div>
          );
        })}
      </div>
      {message ? <p className="mt-5 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm text-neutral-200" role="status">{message}</p> : null}
    </section>
  );
}
