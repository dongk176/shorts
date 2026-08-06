import { describe, expect, it } from "vitest";
import {
  ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY,
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
    }).policy).toBe(ELEVENLABS_FALLBACK_TRANSCRIPTION_POLICY);
  });
});
