import { describe, expect, it } from "vitest";
import { resolveSubtitleTemplateAccess } from "./subtitle-template-release";

describe("subtitle template release", () => {
  it("keeps the feature disabled when the environment master is off", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: false,
      featureEnabled: true,
      publicEnabled: true,
      isAdmin: true,
    }).enabled).toBe(false);
  });

  it("admits only administrators before public promotion", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: true,
    }).enabled).toBe(true);
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: false,
    }).enabled).toBe(false);
  });

  it("does not admit anyone while the runtime feature flag is off", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: false,
      publicEnabled: true,
      isAdmin: true,
    }).enabled).toBe(false);
  });

  it("requires a capable stable release before the public flag admits members", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: true,
      isAdmin: false,
      suitePublicEnabled: false,
    }).enabled).toBe(false);
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: true,
      isAdmin: false,
      suitePublicEnabled: true,
    }).enabled).toBe(true);
  });

  it("admits a selected non-admin pilot before public promotion", () => {
    expect(resolveSubtitleTemplateAccess({
      masterEnabled: true,
      featureEnabled: true,
      publicEnabled: false,
      isAdmin: false,
      pilotEnabled: true,
    }).enabled).toBe(true);
  });
});
