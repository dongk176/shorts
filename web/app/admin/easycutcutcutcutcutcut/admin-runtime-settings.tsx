"use client";

import { useEffect, useRef, useState } from "react";
import { updateFreeUsageGrantSetting } from "./free-usage-grant-actions";

function date(value: string | null) {
  if (!value) return "초기 설정";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function AdminRuntimeSettings({
  initialEnabled,
  environmentEnabled,
  initialUpdatedAt,
  initialUpdatedBy,
}: {
  initialEnabled: boolean;
  environmentEnabled: boolean;
  initialUpdatedAt: string | null;
  initialUpdatedBy: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [updatedBy, setUpdatedBy] = useState(initialUpdatedBy);
  const [requestedEnabled, setRequestedEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (requestedEnabled !== null && !dialog.open) dialog.showModal();
    if (requestedEnabled === null && dialog.open) dialog.close();
  }, [requestedEnabled]);

  const closeConfirmation = () => {
    if (saving) return;
    setRequestedEnabled(null);
  };

  const confirmChange = async () => {
    if (requestedEnabled === null || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await updateFreeUsageGrantSetting(requestedEnabled);
      setEnabled(result.enabled);
      setUpdatedAt(result.updatedAt);
      setUpdatedBy("현재 관리자");
      setRequestedEnabled(null);
      setMessage(result.effectiveEnabled
        ? "무료 사용량 신규 지급을 시작했습니다."
        : result.enabled
          ? "관리자 설정은 켰지만 배포 환경의 강제 중지 설정이 유지 중입니다."
          : "무료 사용량 신규 지급을 중단했습니다.");
    } catch {
      setRequestedEnabled(null);
      setMessage("설정을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const effectiveEnabled = enabled && environmentEnabled;
  const turningOn = requestedEnabled === true;

  return (
    <div className="mt-7 grid gap-5">
      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5 sm:p-7">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-black text-white">무료 사용량 지급</h2>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
                effectiveEnabled
                  ? "bg-emerald-300/10 text-emerald-200"
                  : "bg-red-300/10 text-red-200"
              }`}>
                {effectiveEnabled ? "ON" : "OFF"}
              </span>
            </div>
            <p id="free-usage-grant-description" className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">
              결제 이력이 없고 현재 유료 권한이 없는 회원에게 다음 로그인 시
              20분을 계정당 한 번 지급합니다.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              마지막 변경 {date(updatedAt)}
              {updatedBy ? ` · ${updatedBy}` : ""}
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="무료 사용량 지급"
            aria-describedby="free-usage-grant-description"
            onClick={() => {
              setMessage("");
              setRequestedEnabled(!enabled);
            }}
            className={`relative h-10 w-[72px] shrink-0 rounded-full border p-1 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white ${
              enabled
                ? "border-emerald-300/50 bg-emerald-400/30"
                : "border-white/15 bg-black/30"
            }`}
          >
            <span
              aria-hidden="true"
              className={`block h-8 w-8 rounded-full bg-white shadow-lg transition-transform ${
                enabled ? "translate-x-8" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        {!environmentEnabled ? (
          <p className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/[.06] px-4 py-3 text-xs leading-5 text-amber-100">
            배포 환경의 긴급 중지 설정이 활성화되어 있어 관리자 토글이 ON이어도 실제 지급은 중단됩니다.
          </p>
        ) : null}
        {message ? (
          <p className="mt-5 rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm text-neutral-200" role="status">
            {message}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5 text-sm leading-6 text-neutral-400 sm:p-7">
        <h2 className="font-black text-white">전환 시 영향</h2>
        <ul className="mt-3 grid gap-2">
          <li>• OFF는 이후 로그인에서 발생하는 신규 지급만 막습니다.</li>
          <li>• 이미 지급된 무료 시간과 안내 이력은 회수하거나 변경하지 않습니다.</li>
          <li>• 다시 ON으로 바꾸면 아직 한 번도 받지 않은 대상 회원만 다음 로그인에서 지급됩니다.</li>
        </ul>
      </section>

      <dialog
        ref={dialogRef}
        onCancel={(event) => {
          event.preventDefault();
          closeConfirmation();
        }}
        className="m-auto w-[calc(100%-32px)] max-w-md rounded-[24px] border border-white/10 bg-[#202324] p-0 text-neutral-100 shadow-[0_32px_100px_rgba(0,0,0,.72)] backdrop:bg-black/80 backdrop:backdrop-blur-sm"
        aria-modal="true"
        aria-labelledby="free-usage-confirmation-title"
        aria-describedby="free-usage-confirmation-description"
      >
        <div className="p-6 sm:p-8">
          <p className={`text-xs font-black uppercase tracking-[.18em] ${
            turningOn ? "text-emerald-300" : "text-red-300"
          }`}>
            설정 변경 확인
          </p>
          <h2 id="free-usage-confirmation-title" className="mt-2 text-2xl font-black tracking-tight text-white">
            무료 사용량 지급을 {turningOn ? "켤까요?" : "끌까요?"}
          </h2>
          <p id="free-usage-confirmation-description" className="mt-4 text-sm leading-6 text-neutral-300">
            {turningOn
              ? "아직 무료 시간을 받지 않았고 결제 이력이 없는 회원은 다음 로그인 시 20분을 한 번 받습니다."
              : "이후 로그인부터 신규 지급만 중단합니다. 이미 지급된 무료 시간은 그대로 사용할 수 있습니다."}
          </p>
          <div className="mt-7 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={closeConfirmation}
              disabled={saving}
              autoFocus
              className="min-h-11 rounded-xl border border-white/10 px-4 text-sm font-bold text-neutral-300 transition hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void confirmChange()}
              disabled={saving}
              className={`min-h-11 rounded-xl px-4 text-sm font-black text-white transition disabled:cursor-wait disabled:opacity-60 ${
                turningOn
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-red-600 hover:bg-red-500"
              }`}
            >
              {saving ? "변경 중..." : turningOn ? "지급 켜기" : "지급 끄기"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
