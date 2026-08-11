import type { Sql, TransactionSql } from "postgres";
import {
  resolveEditorRelease,
  subtitleEditingReleaseEnabled,
} from "@/lib/editor-rendering-release";

export const ELEVENLABS_TRANSCRIPTION_FLAG_KEY = "elevenlabs_transcription";
export const ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY =
  "elevenlabs_transcription_public";
export const ELEVENLABS_PUBLIC_COMPLIANCE_APPROVED_FLAG_KEY =
  "elevenlabs_public_compliance_approved";

export const OPENAI_STABLE_TRANSCRIPTION_POLICY = "openai_stable";
export const ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY =
  "elevenlabs_primary_openai_fallback";

export type TranscriptionPolicy =
  | typeof OPENAI_STABLE_TRANSCRIPTION_POLICY
  | typeof ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY;

export function hasWordTimedTranscription(input: {
  policy: unknown;
  provider: unknown;
  model: unknown;
}) {
  if (input.policy !== ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY) return false;
  const provider = String(input.provider || "").trim().toLowerCase();
  const model = String(input.model || "").trim().toLowerCase();
  return provider === "elevenlabs"
    || (
      (provider === "openai" || provider === "mixed")
      && model.includes("whisper")
    );
}

export type ElevenLabsTranscriptionAccess = {
  enabled: boolean;
  masterEnabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
  pilotEnabled: boolean;
  suitePublicEnabled: boolean;
  policy: TranscriptionPolicy;
};

function masterSwitchEnabled() {
  return process.env.ELEVENLABS_TRANSCRIPTION_ENABLED?.trim().toLowerCase() === "true";
}

export function resolveElevenLabsTranscriptionAccess(input: {
  masterEnabled: boolean;
  featureEnabled: boolean;
  publicEnabled: boolean;
  isAdmin: boolean;
  pilotEnabled?: boolean;
  suitePublicEnabled?: boolean;
}): ElevenLabsTranscriptionAccess {
  const pilotEnabled = input.pilotEnabled === true;
  const suitePublicEnabled = input.suitePublicEnabled === true;
  const enabled = input.masterEnabled
    && input.featureEnabled
    && (
      input.isAdmin
      || pilotEnabled
      || (input.publicEnabled && suitePublicEnabled)
    );
  return {
    ...input,
    pilotEnabled,
    suitePublicEnabled,
    enabled,
    policy: enabled
      ? ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY
      : OPENAI_STABLE_TRANSCRIPTION_POLICY,
  };
}

function accessFromRows(
  flagRows: Array<{ flagKey?: unknown; enabled?: unknown }>,
  adminRows: Array<{ isAdmin?: unknown }>,
  release: Awaited<ReturnType<typeof resolveEditorRelease>>,
) {
  const flags = new Map(flagRows.map((row) => [String(row.flagKey || ""), row.enabled === true]));
  return resolveElevenLabsTranscriptionAccess({
    masterEnabled: masterSwitchEnabled(),
    featureEnabled: flags.get(ELEVENLABS_TRANSCRIPTION_FLAG_KEY) === true,
    publicEnabled: flags.get(ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY) === true,
    isAdmin: adminRows[0]?.isAdmin === true,
    pilotEnabled: release.channel === "canary"
      && subtitleEditingReleaseEnabled(release),
    suitePublicEnabled: release.channel === "stable"
      && subtitleEditingReleaseEnabled(release),
  });
}

async function readAccess(
  db: Sql | TransactionSql,
  userId: string | null,
  lock: boolean,
) {
  if (!masterSwitchEnabled()) {
    return resolveElevenLabsTranscriptionAccess({
      masterEnabled: false,
      featureEnabled: false,
      publicEnabled: false,
      isAdmin: false,
      pilotEnabled: false,
      suitePublicEnabled: false,
    });
  }
  const flagRows = lock ? await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${ELEVENLABS_TRANSCRIPTION_FLAG_KEY},
      ${ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY}
    )
    for share
  ` : await db`
    select flag_key,enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key in (
      ${ELEVENLABS_TRANSCRIPTION_FLAG_KEY},
      ${ELEVENLABS_TRANSCRIPTION_PUBLIC_FLAG_KEY}
    )
  `;
  const adminRows = !userId ? [] : lock ? await db`
    select is_admin from shorts_mvp.app_users
    where id=${userId} limit 1 for share
  ` : await db`
    select is_admin from shorts_mvp.app_users
    where id=${userId} limit 1
  `;
  const release = await resolveEditorRelease(db, userId);
  return accessFromRows(flagRows, adminRows, release);
}

export async function getElevenLabsTranscriptionAccess(
  db: Sql | TransactionSql,
  userId: string | null,
) {
  return readAccess(db, userId, false);
}

export async function lockElevenLabsTranscriptionAccess(
  db: TransactionSql,
  userId: string | null,
) {
  return readAccess(db, userId, true);
}
