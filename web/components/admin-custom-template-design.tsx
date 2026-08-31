"use client";

import { useActionState, useId } from "react";
import { setCustomTemplateDesignMode } from "@/app/admin/easycutcutcutcutcutcut/custom-template-design-actions";
import { userFacingErrorMessage } from "@/lib/public-error";

export type CustomTemplateDesignMode = "off" | "admin" | "public";
type DesignActionResult = {
  ok: boolean;
  error?: string;
  message?: string;
  mode?: CustomTemplateDesignMode;
};

const modes = [
  { value: "off", label: "꺼짐", description: "새 업로드·사용 중지" },
  { value: "admin", label: "관리자만", description: "관리자 계정에서 먼저 테스트" },
  { value: "public", label: "일반 공개", description: "기존 이용 권한에 따라 제공" },
] as const;

export function AdminCustomTemplateDesign({
  mode,
  readyForAdmin,
  readyForPublic,
  readinessMessage,
}: {
  mode: CustomTemplateDesignMode;
  readyForAdmin: boolean;
  readyForPublic: boolean;
  readinessMessage?: string;
}) {
  const readinessId = useId();
  const [result, submitAction, pending] = useActionState<DesignActionResult, FormData>(
    async (previous, formData) => {
      const requested = formData.get("mode");
      if ((requested === "admin" && !readyForAdmin) || (requested === "public" && !readyForPublic)) {
        return { ...previous, ok: false, message: undefined, error: readinessMessage || "필요한 배포·검증 확인이 완료되지 않았습니다." };
      }
      try {
        const next = await setCustomTemplateDesignMode(formData);
        return { ...previous, error: undefined, ...next };
      } catch (error) {
        return { ...previous, ok: false, message: undefined, error: userFacingErrorMessage(error, "공개 상태를 변경하지 못했습니다. 현재 상태를 다시 확인해 주세요.") };
      }
    },
    { ok: true },
  );
  const currentMode = result.mode || mode;
  const currentLabel = modes.find((item) => item.value === currentMode)!.label;
  const blocked = !readyForAdmin || !readyForPublic;

  return <section aria-label="내 배경·템플릿 텍스트 공개 관리" className="mt-7 rounded-2xl border border-white/10 bg-[#151819] p-5 sm:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-black text-white">내 배경·템플릿 텍스트</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-400">배경 업로드·보관·재사용과 템플릿의 고정 문구를 함께 공개합니다. 일반 공개 전 관리자 계정으로 실제 영상까지 확인해 주세요.</p>
      </div>
      <span className={`rounded-full px-3 py-1.5 text-xs font-black ${currentMode === "public" ? "bg-emerald-300/10 text-emerald-200" : currentMode === "admin" ? "bg-amber-300/10 text-amber-100" : "bg-white/5 text-neutral-400"}`}>{currentLabel}</span>
    </div>
    <form action={submitAction} aria-busy={pending} className="mt-5 grid gap-2 sm:grid-cols-3">
      {modes.map((item) => {
        // OFF never depends on rollout readiness; it remains the safe stop path.
        const ready = item.value === "off" || (item.value === "admin" ? readyForAdmin : readyForPublic);
        return <button
          key={item.value}
          type="submit"
          name="mode"
          value={item.value}
          disabled={pending || !ready}
          aria-pressed={currentMode === item.value}
          aria-describedby={!ready ? readinessId : undefined}
          className={`min-h-16 rounded-xl border px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${currentMode === item.value ? "border-[#ff715e]/60 bg-[#ff715e]/15 text-white" : "border-white/10 text-neutral-200 hover:border-white/25 hover:bg-white/[.04]"}`}
        >
          <strong className="block text-sm font-black">{item.value === "public" ? "다운로드 영상 확인 후 공개" : item.label}</strong>
          <span className="mt-1 block text-[11px] text-neutral-400">{item.description}</span>
        </button>;
      })}
    </form>
    {blocked && <p id={readinessId} className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[.05] px-4 py-3 text-xs leading-5 text-amber-100">{readinessMessage || "필요한 배포·검증 확인이 완료된 단계만 선택할 수 있습니다. 공개 준비 중에도 ‘꺼짐’으로 전환할 수 있습니다."}</p>}
    <p className="mt-4 text-xs leading-5 text-neutral-300">자동 확인은 서버의 생성·재편집 완료 기록을 검사합니다. 실제 다운로드 영상의 배경·문구·줄바꿈·순서를 미리보기와 직접 비교한 뒤 공개 버튼을 눌러 주세요.</p>
    <p className="mt-4 text-xs leading-5 text-neutral-500">‘꺼짐’은 신규 사용만 중지합니다. 이미 만든 영상, 보관한 배경, 진행 중 작업은 유지하며 기존 편집기의 수동 텍스트 기능은 계속 사용할 수 있습니다.</p>
    {pending && <p role="status" className="mt-3 text-xs text-neutral-300">공개 상태를 변경하고 있습니다…</p>}
    {!pending && result.error && <p role="alert" className="mt-3 text-sm text-red-200">{result.error}</p>}
    {!pending && result.ok && result.message && <p role="status" className="mt-3 text-sm text-emerald-200">{result.message}</p>}
  </section>;
}
