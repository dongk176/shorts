import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) => readFileSync(
  new URL(relativePath, import.meta.url),
  "utf8",
);
const actions = source("./editor-release-actions.ts");
const dashboard = source("./admin-editor-releases.tsx");
const page = source("./page.tsx");

function actionSource(name: string, nextName: string) {
  const start = actions.indexOf(`export async function ${name}`);
  const end = actions.indexOf(`export async function ${nextName}`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return actions.slice(start, end);
}

function sourceBetween(startNeedle: string, endNeedle?: string) {
  const start = actions.indexOf(startNeedle);
  const end = endNeedle
    ? actions.indexOf(endNeedle, start + startNeedle.length)
    : actions.length;
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return actions.slice(start, end);
}

describe("administrator render v4 rollout control", () => {
  it("loads and displays the authoritative v4 release state", () => {
    for (const column of [
      "render_v4_internal_enabled",
      "render_v4_rollout_percent",
      "render_v4_kill_switch",
      "render_v4_candidate_last_transition",
      "render_v4_stable_last_transition",
      "render_spec_version",
      "caption_render_spec_version",
      "font_manifest_sha256",
    ]) expect(page).toContain(column);
    for (const prop of [
      "renderV4InternalEnabled",
      "renderV4RolloutPercent",
      "renderV4KillSwitch",
      "renderV4CandidateLastTransition",
      "renderV4StableLastTransition",
    ]) expect(page).toContain(prop);
    expect(dashboard).toContain("렌더 v4 단계 공개");
    expect(dashboard).toContain("5% → 25% → 100%");
  });

  it("requires explicit checked internal enable and audits it", () => {
    const body = actionSource(
      "enableEditorRenderV4Internal",
      "emergencyStopEditorRenderV4",
    );
    expect(body).toContain("for update");
    expect(body).toContain("assertExactRenderV4Capability");
    expect(body).toContain("v4IsolatedChecks");
    expect(body).toContain("editor_release_testers");
    expect(body).toContain("canEnableEditorRenderV4Internal");
    expect(body).toContain("render_v4_internal_enabled=true");
    expect(body).toContain("render_v4_kill_switch=false");
    expect(body).toContain("editor_release.render_v4_internal_enabled");
    expect(dashboard).toContain("내부 v4 명시적 활성화");
  });

  it("blocks zero-percent emergency bypass through internal enable", () => {
    const body = actionSource(
      "enableEditorRenderV4Internal",
      "emergencyStopEditorRenderV4",
    );
    const stateLock = body.indexOf("for update");
    const latestAuditRead = body.indexOf("loadLatestEditorRenderV4Transition(");
    expect(stateLock).toBeGreaterThanOrEqual(0);
    expect(latestAuditRead).toBeGreaterThan(stateLock);
    expect(body).toContain("isEditorRenderV4EmergencyForRelease");
    expect(body).toContain("EDITOR_RENDER_V4_NEW_RELEASE_REQUIRED");
    expect(body).toMatch(
      /canEnableEditorRenderV4Internal\([\s\S]*latestTransition\.releaseId,[\s\S]*releaseId/,
    );
  });

  it("makes emergency stop sticky while preserving the desired percentage", () => {
    const body = actionSource(
      "emergencyStopEditorRenderV4",
      "advanceEditorRenderV4Rollout",
    );
    expect(body).toContain("render_v4_internal_enabled=false");
    expect(body).toContain("render_v4_kill_switch=true");
    expect(body).not.toContain("set render_v4_rollout_percent=");
    expect(body).toContain("automaticResumeAllowed: false");
    expect(body).toContain("editorRenderV4EmergencyStoppedAction");
    expect(dashboard).toContain("자동으로 다시 켜지지 않습니다");
    expect(dashboard).toContain("v4 긴급 중단");
  });

  it("permits only checked sequential public steps and audits each step", () => {
    const body = actionSource(
      "advanceEditorRenderV4Rollout",
      "promoteEditorRelease",
    );
    expect(actions).toContain("z.literal(5)");
    expect(actions).toContain("z.literal(25)");
    expect(actions).toContain("z.literal(100)");
    expect(body).toContain("nextEditorRenderV4RolloutPercent");
    expect(body).toContain("assertRenderV4CanaryEvidence");
    expect(body).toContain("isEditorRenderV4EmergencyForRelease");
    expect(body).toContain("EDITOR_RENDER_V4_NEW_RELEASE_REQUIRED");
    expect(body).toContain("render_v4_rollout_percent=${currentPercent}");
    expect(body).toContain("render_v4_kill_switch=${killSwitch}");
    expect(body).toContain("editor_release.render_v4_rollout_advanced");
  });

  it("reads the release-scoped latest audit only after acquiring rollout locks", () => {
    const stableLoader = sourceBetween(
      "async function loadStableRenderV4RolloutState",
      "export async function advanceEditorRenderV4Rollout",
    );
    expect(stableLoader).not.toContain("join lateral");
    expect(stableLoader.indexOf("for update of state,release"))
      .toBeLessThan(stableLoader.indexOf(
        "loadLatestEditorRenderV4Transition(",
      ));
    expect(stableLoader).toContain("releaseId");
  });

  it("removes same-release resume and requires a newly verified release", () => {
    expect(actions).not.toContain("resumeEditorRenderV4Rollout");
    expect(actions).not.toContain("editor_release.render_v4_rollout_resumed");
    expect(dashboard).not.toContain("같은 비율");
    expect(dashboard).toContain("새 소스·이미지로 검증된 릴리스");
  });

  it("promotes v4 stopped at zero without changing legacy or v2 promotion", () => {
    const body = actionSource("promoteEditorRelease", "publishSubtitleSuite");
    expect(body).toContain("if (isRenderV4Release)");
    expect(body).toMatch(
      /render_v4_internal_enabled=false,[\s\S]*render_v4_rollout_percent=0,[\s\S]*render_v4_kill_switch=true/,
    );
    expect(body).toContain("editorRenderV4StoppedOnPromotionAction");
    expect(body).toContain("automaticPublicRolloutAllowed: false");
    expect(body).toContain("} else {");
    expect(body).toContain(": isRenderV4Release ? 0 : 100");
    expect(body).toContain("else if (isRenderV4Release)");
    expect(dashboard).toContain("v4 승격(0% 정지)");
  });

  it("resets non-v4 rollback to zero and scopes every v4 emergency", () => {
    const body = sourceBetween("export async function rollbackEditorRelease");
    expect(body).toContain("affectedRenderV4Releases");
    expect(body).toMatch(
      /where id=any\(\$\{affectedReleaseIds\}\)[\s\S]*render_spec_version=4[\s\S]*caption_render_spec_version=4/,
    );
    expect(body).toContain("editorRenderV4EmergencyStoppedAction");
    expect(body).toContain("editorRenderV4AuditEntityId");
    expect(body).toContain("rollbackTargetReleaseId");
    expect(body).toContain("automaticResumeAllowed: false");
    expect(body).toContain("rollbackTargetIsRenderV4");
    expect(body).toContain("render_v4_rollout_percent=0");
    expect(body).toContain("for (const releaseId of scopedReleaseIds)");
    expect(body.indexOf("set status='stable',rolled_back_at=null"))
      .toBeLessThan(body.lastIndexOf("editorRenderV4EmergencyStoppedAction"));
  });

  it("resets a stopped prior release when a new v4 candidate starts", () => {
    const body = actionSource(
      "startEditorReleaseCanary",
      "pauseEditorReleaseCanary",
    );
    expect(body).toContain("resetStoppedPriorRelease");
    expect(body).toContain("latestTransition.releaseId !== releaseId");
    expect(body).toContain("render_v4_rollout_percent=0");
    expect(body).toContain("editorRenderV4StoppedForNewCandidateAction");
  });

  it("serializes state changes behind a renewable infrastructure lease", () => {
    const helper = sourceBetween(
      "async function assertEditorRenderV4InfrastructureLeaseInactive",
      "async function assertChecksPassed",
    );
    expect(helper).toContain("render_v4_infra_lease_expires_at > clock_timestamp()");
    expect(helper).toContain("for update");
    expect(helper).toContain("EDITOR_RENDER_V4_INFRA_LEASE_ACTIVE");
    for (const [name, next] of [
      ["startEditorReleaseCanary", "pauseEditorReleaseCanary"],
      ["pauseEditorReleaseCanary", "recordEditorReleaseCanaryCheck"],
      ["enableEditorRenderV4Internal", "emergencyStopEditorRenderV4"],
      ["promoteEditorRelease", "publishSubtitleSuite"],
      ["rollbackEditorRelease", ""],
    ] as const) {
      const body = next ? actionSource(name, next) : sourceBetween(
        `export async function ${name}`,
      );
      expect(body).toContain("assertEditorRenderV4InfrastructureLeaseInactive");
    }
    const rolloutLoader = sourceBetween(
      "async function loadStableRenderV4RolloutState",
      "export async function advanceEditorRenderV4Rollout",
    );
    expect(rolloutLoader).toContain("assertEditorRenderV4InfrastructureLeaseInactive");
    const emergency = sourceBetween(
      "export async function emergencyStopEditorRenderV4",
      "async function loadStableRenderV4RolloutState",
    );
    expect(emergency).not.toContain("assertEditorRenderV4InfrastructureLeaseInactive");
  });

  it("orders transition audits by insert sequence and database wall clock", () => {
    expect(actions).toContain("metadata,created_at");
    expect(actions).toContain("clock_timestamp()");
    expect(actions).toContain("editor_render_v4_audit_event_sequence");
    expect(actions).toContain("render_v4_event_sequence");
    expect(actions).toContain(
      "order by audit.render_v4_event_sequence desc nulls last",
    );
    expect(page).toContain(
      "order by audit.render_v4_event_sequence desc nulls last",
    );
    expect(actions).not.toContain("order by audit.event_sequence desc");
    expect(page).not.toContain("order by audit.event_sequence desc");
    expect(page).not.toContain("audit.created_at desc,audit.id desc");
  });

  it("accepts v4 production canary records only while internal v4 is live", () => {
    const body = actionSource(
      "recordEditorReleaseCanaryCheck",
      "enableEditorRenderV4Internal",
    );
    expect(body).toContain("render_v4_internal_enabled");
    expect(body).toContain("render_v4_kill_switch");
    expect(body).toContain("EDITOR_RENDER_V4_INTERNAL_CANARY_REQUIRED");
    expect(dashboard).toContain("내부 v4를 명시적으로 켠 뒤");
  });
});
