import { describe, expect, it } from "vitest";
import {
  ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY,
  hasWordTimedTranscription,
  OPENAI_STABLE_TRANSCRIPTION_POLICY,
  resolveElevenLabsTranscriptionAccess,
} from "./transcription-release";

describe("ElevenLabs transcription release", () => {
  it("keeps everyone on stable OpenAI when the master switch is off", () => {
    const access = resolveElevenLabsTranscriptionAccess({
      masterEnabled: false,
      featureEnabled: true,
      publicEnabled: true,
      isAdmin: true,
    });
    expect(access.enabled).toBe(false);
    expect(access.policy).toBe(OPENAI_STABLE_TRANSCRIPTION_POLICY);
  });

  it("admits only administrators before public promotion", () => {
    const admin = resolveElevenLabsTranscriptionAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: true,
    });
    const member = resolveElevenLabsTranscriptionAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: false,
    });
    expect(admin.policy).toBe(ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY);
    expect(member.policy).toBe(OPENAI_STABLE_TRANSCRIPTION_POLICY);
  });

  it("admits all new jobs only after public promotion", () => {
    expect(resolveElevenLabsTranscriptionAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: true,
      isAdmin: false,
      suitePublicEnabled: true,
    }).policy).toBe(ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY);
  });

  it("admits a selected non-admin pilot before public promotion", () => {
    expect(resolveElevenLabsTranscriptionAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: false,
      pilotEnabled: true,
    }).policy).toBe(ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY);
  });

  it("marks only new ElevenLabs or Whisper candidate transcripts as word timed", () => {
    expect(hasWordTimedTranscription({
      policy: ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY,
      provider: "elevenlabs",
      model: "scribe_v2",
    })).toBe(true);
    expect(hasWordTimedTranscription({
      policy: ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY,
      provider: "openai",
      model: "whisper-1",
    })).toBe(true);
    expect(hasWordTimedTranscription({
      policy: ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY,
      provider: "mixed",
      model: "scribe_v2+whisper-1",
    })).toBe(true);
    expect(hasWordTimedTranscription({
      policy: OPENAI_STABLE_TRANSCRIPTION_POLICY,
      provider: "openai",
      model: "whisper-1",
    })).toBe(false);
    expect(hasWordTimedTranscription({
      policy: ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY,
      provider: null,
      model: null,
    })).toBe(false);
  });
});
