import { describe, expect, it } from "vitest";
import {
  canonicalInitialRenderContract,
  createInitialRenderContract,
} from "@/lib/initial-render-contract";
import type { ResolvedTemplateExecutionSnapshot } from "@/lib/template-execution-snapshot";

const resolvedExecution: ResolvedTemplateExecutionSnapshot = {
  resolvedTemplateId: "dark-minimal",
  resolvedVideoAspectRatio: "9:16",
  templateSnapshot: { presetVersion: 3, brandColor: "#35E6E3" },
  subtitleTemplateSnapshot: null,
  usesUnifiedTemplateSubtitleCanary: false,
};

describe("shared initial render contract", () => {
  it("produces byte-identical renderer JSON regardless of source acquisition", () => {
    const link = createInitialRenderContract({
      resolvedExecution,
      subtitleTemplateId: "pop",
      subtitleCaptionPlacement: "lower",
      brandColor: "#35E6E3",
      enhancedSubtitleTiming: true,
    });
    const upload = createInitialRenderContract({
      resolvedExecution,
      subtitleTemplateId: "pop",
      subtitleCaptionPlacement: "lower",
      brandColor: "#35E6E3",
      enhancedSubtitleTiming: true,
    });
    expect(canonicalInitialRenderContract(upload)).toBe(
      canonicalInitialRenderContract(link),
    );
    expect(upload.subtitleTemplateSnapshot).toMatchObject({
      schemaVersion: 3,
      subtitleTemplateId: "pop",
      timingLeadFrames: 7,
      wordGapPx: 6,
    });
  });

  it("preserves a unified custom-template subtitle snapshot unchanged", () => {
    const unified = {
      schemaVersion: 4 as const,
      origin: "unified-template-v5" as const,
      subtitleTemplateId: "highlight" as const,
      enabled: false,
    } as unknown as NonNullable<
      ResolvedTemplateExecutionSnapshot["subtitleTemplateSnapshot"]
    >;
    const contract = createInitialRenderContract({
      resolvedExecution: {
        ...resolvedExecution,
        subtitleTemplateSnapshot: unified,
        usesUnifiedTemplateSubtitleCanary: true,
      },
      enhancedSubtitleTiming: true,
    });
    expect(contract.subtitleTemplateSnapshot).toBe(unified);
    expect(contract.subtitleTemplateId).toBe("highlight");
  });
});
