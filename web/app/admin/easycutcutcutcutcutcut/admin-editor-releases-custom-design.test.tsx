import { readFileSync } from "node:fs";
import { isValidElement, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ captureState: vi.fn(), start: vi.fn(), promote: vi.fn() }));
// These tests inspect button callbacks and their confirmation contracts without
// a browser or executing any server mutation.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, mocks.captureState],
  useTransition: () => [false, vi.fn()],
}));
vi.mock("./editor-release-actions", () => ({
  startEditorReleaseCanary: mocks.start,
  promoteEditorRelease: mocks.promote,
  addEditorReleaseTester: vi.fn(), advanceEditorRenderV4Rollout: vi.fn(),
  emergencyStopEditorRenderV4: vi.fn(), enableEditorRenderV4Internal: vi.fn(),
  pauseEditorReleaseCanary: vi.fn(), publishSubtitleSuite: vi.fn(),
  recordEditorReleaseCanaryCheck: vi.fn(), removeEditorReleaseTester: vi.fn(),
  rollbackEditorRelease: vi.fn(), setUnifiedTemplateSubtitleCanary: vi.fn(),
  setUnifiedTemplateSubtitlePublic: vi.fn(),
}));

import { AdminEditorReleases, type AdminEditorRelease } from "./admin-editor-releases";

const STABLE = "11111111-1111-4111-8111-111111111111";
const CANDIDATE = "22222222-2222-4222-8222-222222222222";

function release(id: string, verified?: boolean): AdminEditorRelease {
  return {
    id, gitSha: "a".repeat(40), uiVersion: 2, documentVersion: 3,
    subtitleEditingCapable: true, renderSpecVersion: 4, captionRenderSpecVersion: 4,
    fontManifestSha256: "c".repeat(64), workerImageDigest: `sha256:${"b".repeat(64)}`,
    productionJobDefinitionArn: "arn:aws:batch:ap-northeast-2:123456789012:job-definition/render:5",
    status: id === STABLE ? "stable" : "canary_active",
    createdAt: "2026-08-31T00:00:00Z", stagingVerifiedAt: "2026-08-31T00:00:00Z",
    canaryStartedAt: "2026-08-31T00:00:00Z", promotedAt: id === STABLE ? "2026-08-31T00:00:00Z" : null,
    ...(verified === undefined ? {} : { customTemplateDesignVerified: verified }),
  };
}

function props(verified?: boolean, canaryEnabled = false): ComponentProps<typeof AdminEditorReleases> {
  return {
    masterEnvironmentEnabled: true, globalEnvironmentEnabled: true,
    publicEnabled: true, canaryEnabled, renderV4EnvironmentEnabled: true,
    renderV4InternalEnabled: true, renderV4RolloutPercent: 100, renderV4KillSwitch: false,
    successorAdminReleaseId: verified && canaryEnabled ? CANDIDATE : null,
    renderV4CandidateLastTransition: null, renderV4StableLastTransition: null,
    subtitleSuitePublicEnabled: true, unifiedTemplateSubtitleCanaryEnabled: false,
    unifiedTemplateSubtitlePublicEnabled: true,
    stableReleaseId: STABLE, previousStableReleaseId: null, candidateReleaseId: CANDIDATE,
    releases: [release(STABLE), release(CANDIDATE, verified)],
    checks: [
      ...["worker-image", "legacy-no-timeline", "captured-timeline", "editor-v2", "ffprobe", "frame-parity", "browser-worker-visual-parity"].map((checkName) => ({
        releaseId: CANDIDATE, environment: "isolated" as const, checkName,
        status: "passed" as const, updatedAt: "2026-08-31T00:00:00Z",
      })),
      ...["save-render-download", "gemini-comments", "reopen-reedit", "rollback-drill"].map((checkName) => ({
        releaseId: CANDIDATE, environment: "production_canary" as const, checkName,
        status: "passed" as const, updatedAt: "2026-08-31T00:00:00Z",
      })),
    ],
    testers: [], renderStats: [{ releaseId: CANDIDATE, active: 0, failed: 0, succeeded: 2 }],
  };
}

type ButtonProps = { children?: ReactNode; onClick?: () => void; disabled?: boolean };
function collectButtons(node: ReactNode): ButtonProps[] {
  if (Array.isArray(node)) return node.flatMap(collectButtons);
  if (!isValidElement<ButtonProps>(node)) return [];
  return [
    ...(node.type === "button" ? [node.props] : []),
    ...collectButtons(node.props.children),
  ];
}
function findButton(input: ComponentProps<typeof AdminEditorReleases>, label: string) {
  const result = collectButtons(AdminEditorReleases(input)).find((button) => button.children === label);
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}
function capturedConfirmation() {
  return mocks.captureState.mock.calls.at(-1)?.[0] as {
    title: string; description: string; confirmLabel: string; action: () => Promise<unknown>;
  };
}

beforeEach(() => vi.clearAllMocks());

describe("custom design successor release controls", () => {
  it("explicitly preserves current public settings only for an attested candidate with a current stable", async () => {
    const button = findButton(props(true), "카나리 시작");
    expect(button.disabled).toBe(false);
    button.onClick?.();
    const confirmation = capturedConfirmation();
    expect(confirmation.title).toContain("기존 공개 설정을 유지");
    expect(confirmation.description).toContain("현재 Stable과의 호환성 및 새 배경·텍스트 검증");
    await confirmation.action();
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(CANDIDATE, STABLE);
  });

  it("passes the exact current stable to promotion and distinguishes renderer promotion from feature publication", async () => {
    const button = findButton(props(true, true), "기존 공개 설정 유지 · 승격");
    expect(button.disabled).toBe(false);
    button.onClick?.();
    const confirmation = capturedConfirmation();
    expect(confirmation.title).toContain("기존 공개 설정을 유지");
    expect(confirmation.description).toContain("배경·템플릿 텍스트의 일반 공개는 별도 설정");
    await confirmation.action();
    expect(mocks.promote).toHaveBeenCalledExactlyOnceWith(CANDIDATE, STABLE);
  });

  it.each([undefined, false])("retains the original canary action for a non-design candidate (%s)", async (verified) => {
    findButton(props(verified), "카나리 시작").onClick?.();
    const confirmation = capturedConfirmation();
    expect(confirmation.title).toBe("운영 내부 카나리를 시작할까요?");
    await confirmation.action();
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(CANDIDATE);
  });

  it("retains the original stopped-v4 promotion contract for other releases", async () => {
    findButton(props(undefined, true), "v4 승격(0% 정지)").onClick?.();
    const confirmation = capturedConfirmation();
    expect(confirmation.title).toContain("0% 정지 상태");
    expect(confirmation.description).toContain("내부 OFF·공개 0%·긴급 중단 ON");
    await confirmation.action();
    expect(mocks.promote).toHaveBeenCalledExactlyOnceWith(CANDIDATE);
  });

  it("never offers an implicit resetting upgrade when the expected stable is unavailable", () => {
    const input = props(true);
    input.releases = input.releases.filter((item) => item.id !== STABLE);
    expect(findButton(input, "카나리 시작").disabled).toBe(true);
    expect(findButton({ ...input, canaryEnabled: true }, "v4 승격(0% 정지)").disabled).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.promote).not.toHaveBeenCalled();
  });

  it("does not relax existing canary results or pending-job checks for a design upgrade", () => {
    const input = props(true, true);
    input.renderStats[0].active = 1;
    expect(findButton(input, "기존 공개 설정 유지 · 승격").disabled).toBe(true);
    input.renderStats[0].active = 0;
    input.checks = input.checks.filter((check) => check.checkName !== "reopen-reedit");
    expect(findButton(input, "기존 공개 설정 유지 · 승격").disabled).toBe(true);
  });

  it("allows only the verified administrator handoff without changing internal exposure", () => {
    const input = { ...props(true, true), renderV4InternalEnabled: false };
    expect(findButton(input, "기존 공개 설정 유지 · 승격").disabled).toBe(false);
    const buttons = collectButtons(AdminEditorReleases(input));
    const recordButtons = buttons.filter((button) => button.children === "통과" || button.children === "실패");
    expect(recordButtons.length).toBeGreaterThan(0);
    expect(recordButtons.every((button) => button.disabled === false)).toBe(true);
    expect(buttons.some((button) => button.children === "내부 v4 명시적 활성화")).toBe(false);
    for (const successorAdminReleaseId of [null, STABLE]) {
      const unavailable = { ...input, successorAdminReleaseId };
      expect(findButton(unavailable, "기존 공개 설정 유지 · 승격").disabled).toBe(true);
      expect(collectButtons(AdminEditorReleases(unavailable))
        .filter((button) => button.children === "통과" || button.children === "실패")
        .every((button) => button.disabled === true)).toBe(true);
    }
  });

  it("does not imply that pausing the successor silently reopens an old renderer", () => {
    findButton(props(true, true), "카나리 중단").onClick?.();
    expect(capturedConfirmation().description).toContain("인계 제한은 유지");
    expect(capturedConfirmation().description).not.toContain("레거시 경로로 돌아갑니다");
  });

  it("derives the UI marker from exact passed isolated v1 design evidence rather than a user checkbox", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    for (const clause of [
      "design_check.release_id=release.id", "design_check.environment='isolated'",
      "design_check.check_name='render-spec-v4'", "design_check.status='passed'",
      "design_check.details#>>'{customTemplateDesign,version}'='1'",
      "design_check.details#>>'{customTemplateDesign,passed}'='true'",
      "customTemplateDesignVerified: row.customTemplateDesignVerified === true",
    ]) expect(page).toContain(clause);
  });
});
