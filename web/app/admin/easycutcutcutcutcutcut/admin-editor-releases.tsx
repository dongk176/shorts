"use client";

import { useState, useTransition } from "react";
import {
  addEditorReleaseTester,
  advanceEditorRenderV4Rollout,
  emergencyStopEditorRenderV4,
  enableEditorRenderV4Internal,
  pauseEditorReleaseCanary,
  publishSubtitleSuite,
  promoteEditorRelease,
  recordEditorReleaseCanaryCheck,
  removeEditorReleaseTester,
  rollbackEditorRelease,
  setUnifiedTemplateSubtitleCanary,
  setUnifiedTemplateSubtitlePublic,
  startEditorReleaseCanary,
} from "./editor-release-actions";
import {
  canEnableEditorRenderV4Internal,
  editorRenderV4EmergencyStoppedAction,
  nextEditorRenderV4RolloutPercent,
} from "@/lib/editor-render-v4-rollout-control";

export type AdminEditorRelease = {
  id: string;
  gitSha: string;
  uiVersion: number;
  documentVersion: number;
  subtitleEditingCapable: boolean;
  renderSpecVersion: number | null;
  captionRenderSpecVersion: number | null;
  fontManifestSha256: string | null;
  customTemplateDesignVerified?: boolean;
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
  renderV4EnvironmentEnabled: boolean;
  renderV4InternalEnabled: boolean;
  renderV4RolloutPercent: number;
  renderV4KillSwitch: boolean;
  successorAdminReleaseId?: string | null;
  renderV4CandidateLastTransition: string | null;
  renderV4StableLastTransition: string | null;
  subtitleSuitePublicEnabled: boolean;
  unifiedTemplateSubtitleCanaryEnabled: boolean;
  unifiedTemplateSubtitlePublicEnabled: boolean;
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
  "browser-worker-visual-parity": "브라우저·워커 시각 일치",
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
const v4IsolatedCheckNames = [
  ...isolatedCheckNames,
  "browser-worker-visual-parity",
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

function isExactRenderV4Release(release: AdminEditorRelease | undefined) {
  return Boolean(
    release
    && release.renderSpecVersion === 4
    && release.captionRenderSpecVersion === 4
    && /^[0-9a-f]{64}$/.test(release.fontManifestSha256 || ""),
  );
}

export function AdminEditorReleases({
  masterEnvironmentEnabled,
  globalEnvironmentEnabled,
  publicEnabled,
  canaryEnabled,
  renderV4EnvironmentEnabled,
  renderV4InternalEnabled,
  renderV4RolloutPercent,
  renderV4KillSwitch,
  successorAdminReleaseId = null,
  renderV4CandidateLastTransition,
  renderV4StableLastTransition,
  subtitleSuitePublicEnabled,
  unifiedTemplateSubtitleCanaryEnabled,
  unifiedTemplateSubtitlePublicEnabled,
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
  const preservePublicSettings = candidate?.customTemplateDesignVerified === true && Boolean(stable);
  const successorAdminAllowed = preservePublicSettings && canaryEnabled
    && successorAdminReleaseId === candidate?.id && !renderV4KillSwitch;
  const candidateStats = renderStats.find(
    (item) => item.releaseId === candidateReleaseId,
  );
  const stableStats = renderStats.find((item) => item.releaseId === stableReleaseId);
  const checkPassed = (
    releaseId: string | null,
    environment: AdminEditorReleaseCheck["environment"],
    checkName: string,
  ) => checks.some((check) => (
    check.releaseId === releaseId
    && check.environment === environment
    && check.checkName === checkName
    && check.status === "passed"
  ));
  const releaseCanaryReady = (
    release: AdminEditorRelease | undefined,
    stats: AdminEditorReleaseRenderStats | undefined,
  ) => Boolean(
    release
    && (release.renderSpecVersion === 4
      ? v4IsolatedCheckNames
      : isolatedCheckNames
    ).every((name) => checkPassed(release.id, "isolated", name))
    && productionCanaryCheckNames.every(
      (name) => checkPassed(release.id, "production_canary", name),
    )
    && Number(stats?.active || 0) === 0
    && Number(stats?.failed || 0) === 0
    && Number(stats?.succeeded || 0) > 0,
  );
  const promotionReady = Boolean(
    candidate
    && candidate.status === "canary_active"
    && releaseCanaryReady(candidate, candidateStats),
  );
  const candidateIsRenderV4 = isExactRenderV4Release(candidate);
  const stableIsRenderV4 = isExactRenderV4Release(stable);
  const v4InternalChecksReady = Boolean(
    candidateIsRenderV4
    && candidate
    && v4IsolatedCheckNames.every(
      (name) => checkPassed(candidate.id, "isolated", name),
    ),
  );
  const v4PublicChecksReady = Boolean(
    stableIsRenderV4 && releaseCanaryReady(stable, stableStats),
  );
  const v4CandidateEmergencyStopped = renderV4CandidateLastTransition
    === editorRenderV4EmergencyStoppedAction;
  const v4StableEmergencyStopped = renderV4StableLastTransition
    === editorRenderV4EmergencyStoppedAction;
  const v4EmergencyStopped = v4CandidateEmergencyStopped
    || v4StableEmergencyStopped;
  const nextV4RolloutPercent = v4StableEmergencyStopped
    ? null
    : nextEditorRenderV4RolloutPercent(
      renderV4RolloutPercent,
      renderV4KillSwitch,
    );
  const v4InternalCanStart = canEnableEditorRenderV4Internal(
    renderV4RolloutPercent,
    renderV4KillSwitch,
    renderV4CandidateLastTransition,
    candidate?.id || null,
    candidate?.id || "",
  );
  const productionCanaryRecordAllowed = !candidateIsRenderV4
    || ((renderV4InternalEnabled || successorAdminAllowed) && !renderV4KillSwitch);

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
          disabled={
            pending
            || !masterEnvironmentEnabled
            || (candidateIsRenderV4 && !renderV4EnvironmentEnabled)
            || (candidate.customTemplateDesignVerified === true && !stable)
          }
          onClick={() => setConfirmation({
            title: preservePublicSettings
              ? "기존 공개 설정을 유지하며 카나리를 시작할까요?"
              : "운영 내부 카나리를 시작할까요?",
            description: preservePublicSettings
              ? "현재 공개 설정을 유지하고 관리자 계정만 검증된 후속 워커를 사용합니다. 현재 Stable과의 호환성 및 새 배경·텍스트 검증을 서버에서 다시 확인합니다."
              : "등록된 내부 테스트 계정만 후보 UI와 별도 카나리 워커를 사용합니다.",
            confirmLabel: "카나리 시작",
            action: () => preservePublicSettings && stable
              ? startEditorReleaseCanary(candidate.id, stable.id)
              : startEditorReleaseCanary(candidate.id),
          })}
          className="rounded-xl bg-white px-4 py-2.5 text-sm font-black text-black disabled:opacity-40"
        >카나리 시작</button>}
        {canaryEnabled && <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmation({
            title: "카나리를 일시 중단할까요?",
            description: preservePublicSettings
              ? "관리자 카나리를 중지합니다. 신규 생성의 인계 제한은 유지되며, 검증된 인계 완료 또는 복구 절차로만 해제됩니다."
              : "새로운 내부 저장 요청부터 기존 stable 또는 레거시 경로로 돌아갑니다.",
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
            || (candidateIsRenderV4 && !renderV4EnvironmentEnabled)
            || !promotionReady
            || (preservePublicSettings && !successorAdminAllowed)
            || (candidate.customTemplateDesignVerified === true && !stable)
          }
          onClick={() => setConfirmation({
            title: preservePublicSettings
              ? "기존 공개 설정을 유지하며 승격할까요?"
              : candidateIsRenderV4
              ? "v4 릴리스를 0% 정지 상태로 승격할까요?"
              : "모든 사용자에게 공개할까요?",
            description: preservePublicSettings
              ? "기존 공개 설정 유지 방식으로 검증된 동일 이미지를 승격합니다. 현재 Stable, 렌더·폰트 규격과 필수 검사를 다시 확인하며 배경·템플릿 텍스트의 일반 공개는 별도 설정에서 제어합니다."
              : candidateIsRenderV4
              ? "릴리스는 stable로 승격하지만 v4 렌더는 내부 OFF·공개 0%·긴급 중단 ON으로 초기화합니다. 이후 5% 공개를 별도로 확인해야 하며 이미지 재빌드는 발생하지 않습니다."
              : "필수 검사와 카나리 작업을 다시 확인한 뒤 100% 사용자에게 즉시 공개합니다. 이미지 재빌드는 발생하지 않습니다.",
            confirmLabel: preservePublicSettings ? "기존 공개 설정 유지 · 승격" : candidateIsRenderV4 ? "v4 승격 후 정지" : "전체 공개",
            action: () => preservePublicSettings && stable
              ? promoteEditorRelease(candidate.id, stable.id)
              : promoteEditorRelease(candidate.id),
          })}
          className="rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-black text-emerald-950 disabled:opacity-40"
        >{preservePublicSettings ? "기존 공개 설정 유지 · 승격" : candidateIsRenderV4 ? "v4 승격(0% 정지)" : "전체 승격"}</button>}
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
        {publicEnabled
          && stable?.subtitleEditingCapable
          && subtitleSuitePublicEnabled
          && !unifiedTemplateSubtitlePublicEnabled
          && <button
            type="button"
            disabled={pending || !masterEnvironmentEnabled || !globalEnvironmentEnabled}
            onClick={() => setConfirmation({
              title: "통합 자막 템플릿을 일반 사용자에게 공개할까요?",
              description: "성공한 링크 기반 생성 기록과 stable 자막 편집 릴리스, 전사·렌더 스위치를 서버에서 다시 확인한 뒤 일반 유료 사용자와 발급계정에 공개합니다. 파일 업로드는 공개되지 않습니다.",
              confirmLabel: "통합 자막 템플릿 공개",
              action: () => setUnifiedTemplateSubtitlePublic(true),
            })}
            className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-cyan-950 disabled:opacity-40"
          >통합 자막 템플릿 공개</button>}
        {unifiedTemplateSubtitlePublicEnabled && <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmation({
            title: "통합 자막 템플릿 공개를 중단할까요?",
            description: "신규 v5 템플릿 저장·링크 생성·재편집 요청만 차단합니다. 저장 데이터와 완성 영상은 삭제하지 않고 파일 업로드 설정에도 영향을 주지 않습니다.",
            confirmLabel: "통합 자막 공개 중단",
            danger: true,
            action: () => setUnifiedTemplateSubtitlePublic(false),
          })}
          className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2.5 text-sm font-bold text-cyan-100 disabled:opacity-40"
        >통합 자막 공개 중단</button>}
      </div>
      {canaryEnabled && candidate && !promotionReady && <p className="mt-3 text-xs leading-5 text-amber-100/80">
        모든 격리·운영 카나리 검사가 통과하고 성공 렌더가 1건 이상이며,
        진행 중·실패 렌더가 0건일 때만 전체 승격할 수 있습니다.
      </p>}
      {message && <p className="mt-4 rounded-xl bg-black/30 px-3 py-2 text-sm text-white">{message}</p>}
    </div>

    {(candidateIsRenderV4 || stableIsRenderV4) && <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[.04] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-black text-white">렌더 v4 단계 공개</h3>
          <p className="mt-2 text-sm leading-6 text-white/60">
            내부 검증과 공개 비율은 별도입니다. 공개는 5% → 25% → 100% 순서로만 진행됩니다.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-black ${
          renderV4KillSwitch
            ? "bg-red-400/15 text-red-100"
            : renderV4InternalEnabled
              ? "bg-cyan-300/15 text-cyan-100"
              : "bg-emerald-300/15 text-emerald-100"
        }`}>
          {renderV4KillSwitch
            ? "긴급 중단"
            : renderV4InternalEnabled
              ? "내부 v4 활성"
              : `공개 ${renderV4RolloutPercent}%`}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-black/25 p-3">
          <dt className="text-white/50">내부 테스트 계정</dt>
          <dd className="mt-1 font-bold text-white">
            {successorAdminAllowed ? "후속 버전 관리자 검증" : renderV4InternalEnabled && !renderV4KillSwitch ? "v4 사용" : "v4 중단"}
          </dd>
        </div>
        <div className="rounded-xl bg-black/25 p-3">
          <dt className="text-white/50">저장된 공개 비율</dt>
          <dd className="mt-1 font-bold text-white">{renderV4RolloutPercent}%</dd>
        </div>
        <div className="rounded-xl bg-black/25 p-3">
          <dt className="text-white/50">긴급 중단 스위치</dt>
          <dd className={`mt-1 font-bold ${
            renderV4KillSwitch ? "text-red-200" : "text-emerald-200"
          }`}>{renderV4KillSwitch ? "ON · 적용 차단" : "OFF · 적용 가능"}</dd>
        </div>
      </dl>

      {!renderV4EnvironmentEnabled && <div className="mt-4 rounded-xl border border-red-300/25 bg-red-400/10 p-3 text-sm leading-6 text-red-100">
        현재 웹 배포의 v4 렌더 명세 스위치가 꺼져 있어 내부 활성화와 단계 공개가 서버에서도 차단됩니다.
      </div>}

      {renderV4KillSwitch && v4EmergencyStopped && <div className="mt-4 rounded-xl border border-red-300/25 bg-red-400/10 p-3 text-sm leading-6 text-red-100">
        이 릴리스는 긴급 중단되어 다시 활성화할 수 없습니다. DB를 직접 수정하지 말고,
        새 소스·이미지로 검증된 릴리스를 등록해 내부 검증부터 다시 진행해 주세요.
      </div>}
      {stableIsRenderV4
        && renderV4RolloutPercent === 0
        && renderV4KillSwitch
        && !v4EmergencyStopped
        && <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-100">
        v4 승격 직후의 안전 정지 상태입니다. 일반 사용자에게 v4 렌더가 적용되지 않으며, 5% 공개를 별도로 확인해야 합니다.
      </div>}

      <div className="mt-4 flex flex-wrap gap-2">
        {candidateIsRenderV4
          && candidate
          && canaryEnabled
          && !preservePublicSettings
          && (!renderV4InternalEnabled || renderV4KillSwitch)
          && <button
            type="button"
            disabled={
              pending
              || !masterEnvironmentEnabled
              || !renderV4EnvironmentEnabled
              || !v4InternalChecksReady
              || !v4InternalCanStart
            }
            onClick={() => setConfirmation({
              title: "내부 테스트 계정에 v4 렌더를 켤까요?",
              description: "브라우저·워커 시각 일치를 포함한 v4 격리 검사를 서버에서 다시 확인합니다. 공개 비율은 변경하지 않습니다.",
              confirmLabel: "내부 v4 켜기",
              action: () => enableEditorRenderV4Internal(candidate.id),
            })}
            className="rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-cyan-950 disabled:opacity-40"
          >내부 v4 명시적 활성화</button>}

        {stableIsRenderV4
          && stable
          && publicEnabled
          && nextV4RolloutPercent !== null
          && <button
            type="button"
            disabled={
              pending
              || !masterEnvironmentEnabled
              || !globalEnvironmentEnabled
              || !renderV4EnvironmentEnabled
              || !v4PublicChecksReady
            }
            onClick={() => setConfirmation({
              title: `v4를 ${nextV4RolloutPercent}%에 공개할까요?`,
              description: `현재 ${renderV4RolloutPercent}%에서 다음 승인 단계인 ${nextV4RolloutPercent}%로만 이동합니다. 모든 v4 격리·운영 카나리 검사와 성공 렌더를 서버에서 다시 확인합니다.`,
              confirmLabel: `${nextV4RolloutPercent}% 공개`,
              action: () => advanceEditorRenderV4Rollout(
                stable.id,
                nextV4RolloutPercent,
              ),
            })}
            className="rounded-xl bg-emerald-300 px-4 py-2.5 text-sm font-black text-emerald-950 disabled:opacity-40"
          >다음 단계: {nextV4RolloutPercent}%</button>}

        {(!renderV4KillSwitch || renderV4InternalEnabled) && <button
          type="button"
          disabled={pending}
          onClick={() => setConfirmation({
            title: "v4 렌더를 즉시 긴급 중단할까요?",
            description: "내부 v4를 끄고 신규 v4 적용을 즉시 차단합니다. 현재 공개 비율은 감사와 복구를 위해 보존되지만 자동으로 다시 켜지지 않습니다.",
            confirmLabel: "v4 즉시 중단",
            danger: true,
            action: emergencyStopEditorRenderV4,
          })}
          className="rounded-xl border border-red-300/30 bg-red-400/10 px-4 py-2.5 text-sm font-bold text-red-100 disabled:opacity-40"
        >v4 긴급 중단</button>}
      </div>

      {candidateIsRenderV4 && canaryEnabled && !v4InternalChecksReady && <p className="mt-3 text-xs leading-5 text-amber-100/80">
        브라우저·워커 시각 일치를 포함한 모든 v4 격리 검사가 통과해야 내부 v4를 켤 수 있습니다.
      </p>}
      {stableIsRenderV4 && publicEnabled && !v4PublicChecksReady && <p className="mt-3 text-xs leading-5 text-amber-100/80">
        모든 v4 격리·운영 카나리 검사, 성공 렌더 1건 이상, 진행 중·실패 0건을 만족해야 공개할 수 있습니다.
      </p>}
    </div>}

    {canaryEnabled && candidate && <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
      <h3 className="text-base font-black text-white">운영 카나리 확인</h3>
      <p className="mt-2 text-sm leading-6 text-white/55">
        내부 계정으로 실제 시나리오를 확인한 관리자가 결과를 기록합니다. 하나라도 실패하면 전체 승격은 차단됩니다.
      </p>
      {!productionCanaryRecordAllowed && <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">
        v4 후보는 내부 v4를 명시적으로 켠 뒤에 수행한 결과만 운영 카나리 검사로 기록할 수 있습니다.
      </p>}
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
                disabled={pending || !productionCanaryRecordAllowed}
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
                disabled={pending || !productionCanaryRecordAllowed}
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
