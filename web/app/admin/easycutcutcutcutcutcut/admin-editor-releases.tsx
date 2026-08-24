"use client";

import { useState, useTransition } from "react";
import {
  addEditorReleaseTester,
  pauseEditorReleaseCanary,
  publishSubtitleSuite,
  promoteEditorRelease,
  recordEditorReleaseCanaryCheck,
  removeEditorReleaseTester,
  rollbackEditorRelease,
  setUnifiedTemplateSubtitleCanary,
  startEditorReleaseCanary,
} from "./editor-release-actions";

export type AdminEditorRelease = {
  id: string;
  gitSha: string;
  uiVersion: number;
  documentVersion: number;
  subtitleEditingCapable: boolean;
  workerImageDigest: string;
  productionJobDefinitionArn: string;
  status: string;
  createdAt: string;
  stagingVerifiedAt: string | null;
  canaryStartedAt: string | null;
  promotedAt: string | null;
};

export type AdminEditorReleaseCheck = {
  releaseId: string;
  environment: "isolated" | "production_canary";
  checkName: string;
  status: "pending" | "running" | "passed" | "failed";
  updatedAt: string;
};

export type AdminEditorReleaseTester = {
  userId: string;
  email: string;
  displayName: string | null;
  enabled: boolean;
  updatedAt: string;
};

export type AdminEditorReleaseRenderStats = {
  releaseId: string;
  active: number;
  failed: number;
  succeeded: number;
};

type Props = {
  masterEnvironmentEnabled: boolean;
  globalEnvironmentEnabled: boolean;
  publicEnabled: boolean;
  canaryEnabled: boolean;
  subtitleSuitePublicEnabled: boolean;
  unifiedTemplateSubtitleCanaryEnabled: boolean;
  stableReleaseId: string | null;
  previousStableReleaseId: string | null;
  candidateReleaseId: string | null;
  releases: AdminEditorRelease[];
  checks: AdminEditorReleaseCheck[];
  testers: AdminEditorReleaseTester[];
  renderStats: AdminEditorReleaseRenderStats[];
};

type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<unknown>;
};

const checkLabels: Record<string, string> = {
  "worker-image": "워커 이미지",
  "legacy-no-timeline": "이전 영상 호환",
  "captured-timeline": "캡처 타임라인",
  "editor-v2": "통합 편집 문서",
  ffprobe: "영상 규격",
  "frame-parity": "프레임 일치",
  "save-render-download": "저장·렌더·다운로드",
  "gemini-comments": "AI 댓글 재생성",
  "reopen-reedit": "재진입·재편집",
  "rollback-drill": "롤백 훈련",
};
const productionCanaryCheckNames = [
  "save-render-download",
  "gemini-comments",
  "reopen-reedit",
  "rollback-drill",
] as const;
const isolatedCheckNames = [
  "worker-image",
  "legacy-no-timeline",
  "captured-timeline",
  "editor-v2",
  "ffprobe",
  "frame-parity",
] as const;

function short(value: string | null) {
  return value ? value.slice(0, 12) : "없음";
}

function statusLabel(status: string) {
  return {
    built: "빌드됨",
    staging_verified: "격리 검증 완료",
    canary_ready: "카나리 준비",
    canary_active: "카나리 진행 중",
    approved: "승인됨",
    stable: "전체 공개",
    rejected: "거부됨",
    rolled_back: "롤백됨",
  }[status] || status;
}

export function AdminEditorReleases({
  masterEnvironmentEnabled,
  globalEnvironmentEnabled,
  publicEnabled,
  canaryEnabled,
  subtitleSuitePublicEnabled,
  unifiedTemplateSubtitleCanaryEnabled,
  stableReleaseId,
  previousStableReleaseId,
  candidateReleaseId,
  releases,
  checks,
  testers,
  renderStats,
}: Props) {
  const [testerEmail, setTesterEmail] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pending, startTransition] = useTransition();
  const candidate = releases.find((release) => release.id === candidateReleaseId);
  const stable = releases.find((release) => release.id === stableReleaseId);
  const candidateStats = renderStats.find(
    (item) => item.releaseId === candidateReleaseId,
  );
  const checkPassed = (
    environment: AdminEditorReleaseCheck["environment"],
    checkName: string,
  ) => checks.some((check) => (
    check.releaseId === candidateReleaseId
    && check.environment === environment
    && check.checkName === checkName
    && check.status === "passed"
  ));
  const promotionReady = Boolean(
    candidate
    && candidate.status === "canary_active"
    && isolatedCheckNames.every((name) => checkPassed("isolated", name))
    && productionCanaryCheckNames.every(
      (name) => checkPassed("production_canary", name),
    )
    && Number(candidateStats?.active || 0) === 0
    && Number(candidateStats?.failed || 0) === 0
    && Number(candidateStats?.succeeded || 0) > 0,
  );

  function execute(action: () => Promise<unknown>, successMessage: string) {
    startTransition(async () => {
      setMessage("");
      try {
        await action();
        setConfirmation(null);
        setMessage(successMessage);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
      }
    });
  }

  return <section className="space-y-6">
    <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-white">편집기 릴리스</h2>
          <p className="mt-2 text-sm leading-6 text-white/65">
            일반 사용자는 승인 전까지 기존 편집기와 레거시 워커를 계속 사용합니다.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-black ${
          publicEnabled ? "bg-emerald-400/15 text-emerald-200" : "bg-white/10 text-white/70"
        }`}>
          {publicEnabled ? "전체 공개" : canaryEnabled ? "내부 카나리" : "레거시 유지"}
        </span>
      </div>
      {(!masterEnvironmentEnabled || !globalEnvironmentEnabled) && <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-100">
        {!masterEnvironmentEnabled
          ? "서버 마스터 스위치가 꺼져 있어 모든 사용자가 레거시 편집기를 사용합니다."
          : "전체 공개 서버 스위치가 꺼져 있어 내부 카나리는 가능하지만 전체 승격은 차단됩니다."}
      </div>}
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-black/25 p-3"><dt className="text-white/50">Stable</dt><dd className="mt-1 font-bold text-white">{short(stableReleaseId)}</dd></div>
        <div className="rounded-xl bg-black/25 p-3"><dt className="text-white/50">Candidate</dt><dd className="mt-1 font-bold text-white">{short(candidateReleaseId)}</dd></div>
        <div className="rounded-xl bg-black/25 p-3"><dt className="text-white/50">이전 Stable</dt><dd className="mt-1 font-bold text-white">{short(previousStableReleaseId)}</dd></div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {candidate && !canaryEnabled && <button
          type="button"
          disabled={pending || !masterEnvironmentEnabled}
          onClick={() => setConfirmation({
            title: "운영 내부 카나리를 시작할까요?",
            description: "등록된 내부 테스트 계정만 후보 UI와 별도 카나리 워커를 사용합니다.",
            confirmLabel: "카나리 시작",
            action: () => startEditorReleaseCanary(candidate.id),
          })}
          className="rounded-xl bg-white px-4 py-2.5 text-sm font-black text-black disabled:opacity-40"
        >카나리 시작</button>}
        {canaryEnabled && <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmation({
            title: "카나리를 일시 중단할까요?",
            description: "새로운 내부 저장 요청부터 기존 stable 또는 레거시 경로로 돌아갑니다.",
            confirmLabel: "카나리 중단",
            action: pauseEditorReleaseCanary,
          })}
          className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >카나리 중단</button>}
        {canaryEnabled && candidate && <button
          type="button"
          disabled={
            pending
            || !masterEnvironmentEnabled
            || !globalEnvironmentEnabled
            || !promotionReady
          }
          onClick={() => setConfirmation({
            title: "모든 사용자에게 공개할까요?",
            description: "필수 검사와 카나리 작업을 다시 확인한 뒤 100% 사용자에게 즉시 공개합니다. 이미지 재빌드는 발생하지 않습니다.",
            confirmLabel: "전체 공개",
            action: () => promoteEditorRelease(candidate.id),
          })}
          className="rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-black text-emerald-950 disabled:opacity-40"
        >전체 승격</button>}
        {(publicEnabled || canaryEnabled) && <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmation({
            title: "레거시 편집기로 즉시 롤백할까요?",
            description: "새 요청만 레거시 경로로 전환하며 이미 실행 중인 렌더링은 해당 릴리스로 마무리됩니다.",
            confirmLabel: "레거시로 롤백",
            danger: true,
            action: () => rollbackEditorRelease("legacy"),
          })}
          className="rounded-xl border border-red-300/30 bg-red-400/10 px-4 py-2.5 text-sm font-bold text-red-100 disabled:opacity-40"
        >레거시 롤백</button>}
        {publicEnabled && previousStableReleaseId && <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmation({
            title: "직전 Stable로 롤백할까요?",
            description: `현재 릴리스를 중단하고 ${short(previousStableReleaseId)} 릴리스로 전환합니다.`,
            confirmLabel: "직전 Stable로 롤백",
            danger: true,
            action: () => rollbackEditorRelease("previous"),
          })}
          className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-2.5 text-sm font-bold text-amber-100 disabled:opacity-40"
        >직전 Stable 롤백</button>}
        {publicEnabled && stable?.subtitleEditingCapable && <button
          type="button"
          disabled={pending || subtitleSuitePublicEnabled}
          onClick={() => setConfirmation({
            title: "검증된 자막 기능을 모든 사용자에게 공개할까요?",
            description: "일반 사용자 프로젝트 3건, 자막 렌더 상태, ElevenLabs 공개 준수 승인을 서버에서 다시 확인한 뒤 자막 편집·전사·템플릿을 함께 공개합니다.",
            confirmLabel: "자막 기능 공개",
            action: publishSubtitleSuite,
          })}
          className="rounded-xl bg-sky-300 px-4 py-2.5 text-sm font-black text-sky-950 disabled:opacity-40"
        >{subtitleSuitePublicEnabled ? "자막 기능 공개됨" : "자막 기능 전체 공개"}</button>}
        {canaryEnabled
          && candidate?.subtitleEditingCapable
          && !unifiedTemplateSubtitleCanaryEnabled
          && <button
            type="button"
            disabled={pending || !masterEnvironmentEnabled}
            onClick={() => setConfirmation({
              title: "통합 템플릿 자막 카나리를 켤까요?",
              description: "지정된 관리자 테스트 계정만 v5 템플릿 자막을 사용할 수 있습니다. 기존 공개 자막 기능에는 영향을 주지 않습니다.",
              confirmLabel: "통합 자막 카나리 켜기",
              action: () => setUnifiedTemplateSubtitleCanary(true),
            })}
            className="rounded-xl bg-violet-300 px-4 py-2.5 text-sm font-black text-violet-950 disabled:opacity-40"
          >통합 자막 카나리 켜기</button>}
        {unifiedTemplateSubtitleCanaryEnabled && <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmation({
            title: "통합 템플릿 자막 카나리만 중단할까요?",
            description: "새 v5 템플릿 요청만 즉시 차단합니다. 기존 공개 자막 기능과 진행 중인 정상 작업은 유지됩니다.",
            confirmLabel: "통합 자막 카나리 중단",
            danger: true,
            action: () => setUnifiedTemplateSubtitleCanary(false),
          })}
          className="rounded-xl border border-violet-300/30 bg-violet-400/10 px-4 py-2.5 text-sm font-bold text-violet-100 disabled:opacity-40"
        >통합 자막 카나리 중단</button>}
      </div>
      {canaryEnabled && candidate && !promotionReady && <p className="mt-3 text-xs leading-5 text-amber-100/80">
        모든 격리·운영 카나리 검사가 통과하고 성공 렌더가 1건 이상이며,
        진행 중·실패 렌더가 0건일 때만 전체 승격할 수 있습니다.
      </p>}
      {message && <p className="mt-4 rounded-xl bg-black/30 px-3 py-2 text-sm text-white">{message}</p>}
    </div>

    {canaryEnabled && candidate && <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <h3 className="text-base font-black text-white">운영 카나리 확인</h3>
      <p className="mt-2 text-sm leading-6 text-white/55">
        내부 계정으로 실제 시나리오를 확인한 관리자가 결과를 기록합니다. 하나라도 실패하면 전체 승격은 차단됩니다.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {productionCanaryCheckNames.map((checkName) => {
          const check = checks.find((item) => (
            item.releaseId === candidate.id
            && item.environment === "production_canary"
            && item.checkName === checkName
          ));
          return <div key={checkName} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-black/20 p-3">
            <div>
              <strong className="block text-sm text-white">{checkLabels[checkName]}</strong>
              <span className={`mt-1 block text-xs ${
                check?.status === "passed"
                  ? "text-emerald-300"
                  : check?.status === "failed"
                    ? "text-red-300"
                    : "text-white/45"
              }`}>{check?.status || "미확인"}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={pending}
                onClick={() => execute(
                  () => recordEditorReleaseCanaryCheck(
                    candidate.id,
                    checkName,
                    "passed",
                  ),
                  `${checkLabels[checkName]} 통과를 기록했습니다.`,
                )}
                className="rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-2 text-xs font-bold text-emerald-100 disabled:opacity-40"
              >통과</button>
              <button
                type="button"
                disabled={pending}
                onClick={() => execute(
                  () => recordEditorReleaseCanaryCheck(
                    candidate.id,
                    checkName,
                    "failed",
                  ),
                  `${checkLabels[checkName]} 실패를 기록했습니다.`,
                )}
                className="rounded-lg border border-red-300/25 bg-red-400/10 px-2.5 py-2 text-xs font-bold text-red-100 disabled:opacity-40"
              >실패</button>
            </div>
          </div>;
        })}
      </div>
    </div>}

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
        <h3 className="text-base font-black text-white">릴리스와 검사 결과</h3>
        <div className="mt-4 space-y-4">
          {releases.length === 0 && <p className="text-sm text-white/55">등록된 후보 릴리스가 없습니다.</p>}
          {releases.map((release) => {
            const releaseChecks = checks.filter((check) => check.releaseId === release.id);
            return <article key={release.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong className="text-sm text-white">{release.gitSha.slice(0, 12)}</strong>
                  <span className="ml-2 text-xs text-white/50">UI {release.uiVersion} · 문서 {release.documentVersion}{release.subtitleEditingCapable ? " · 자막 공개 검증" : ""}</span>
                </div>
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/75">{statusLabel(release.status)}</span>
              </div>
              <p className="mt-2 break-all font-mono text-[11px] text-white/45">{release.workerImageDigest}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {releaseChecks.map((check) => <div key={`${check.environment}-${check.checkName}`} className="flex items-center justify-between rounded-lg bg-white/[.04] px-2.5 py-2 text-xs">
                  <span className="text-white/70">{checkLabels[check.checkName] || check.checkName}</span>
                  <strong className={
                    check.status === "passed"
                      ? "text-emerald-300"
                      : check.status === "failed"
                        ? "text-red-300"
                        : "text-amber-200"
                  }>{check.status}</strong>
                </div>)}
              </div>
            </article>;
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
        <h3 className="text-base font-black text-white">내부 테스트 계정</h3>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            execute(
              async () => {
                await addEditorReleaseTester(testerEmail);
                setTesterEmail("");
              },
              "테스트 계정을 추가했습니다.",
            );
          }}
        >
          <input
            type="email"
            required
            value={testerEmail}
            onChange={(event) => setTesterEmail(event.target.value)}
            placeholder="회원 이메일"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white"
          />
          <button disabled={pending} className="rounded-xl bg-white px-3 py-2.5 text-sm font-black text-black disabled:opacity-40">추가</button>
        </form>
        <div className="mt-4 space-y-2">
          {testers.filter((tester) => tester.enabled).map((tester) => <div key={tester.userId} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 p-3">
            <div className="min-w-0">
              <strong className="block truncate text-sm text-white">{tester.displayName || tester.email}</strong>
              <span className="block truncate text-xs text-white/45">{tester.email}</span>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => execute(
                () => removeEditorReleaseTester(tester.userId),
                "테스트 계정을 제외했습니다.",
              )}
              className="shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-xs font-bold text-white/70 disabled:opacity-40"
            >제외</button>
          </div>)}
        </div>
      </div>
    </div>

    {confirmation && <div className="fixed inset-0 z-[200] grid place-items-center bg-black/75 p-5" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) setConfirmation(null);
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="editor-release-confirm-title" className="w-full max-w-md rounded-2xl border border-white/15 bg-[#1b1b1f] p-6 shadow-2xl">
        <h3 id="editor-release-confirm-title" className="text-xl font-black text-white">{confirmation.title}</h3>
        <p className="mt-3 text-sm leading-6 text-white/65">{confirmation.description}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button disabled={pending} onClick={() => setConfirmation(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-white">취소</button>
          <button disabled={pending} onClick={() => execute(confirmation.action, "릴리스 상태를 변경했습니다.")} className={`rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-40 ${confirmation.danger ? "bg-red-400 text-red-950" : "bg-white text-black"}`}>
            {pending ? "처리 중..." : confirmation.confirmLabel}
          </button>
        </div>
      </section>
    </div>}
  </section>;
}
