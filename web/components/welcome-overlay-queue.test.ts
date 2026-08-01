import { describe, expect, it } from "vitest";
import {
  nextWelcomeOverlayStage,
  welcomeOverlayStages,
} from "@/lib/welcome-overlay-queue";

describe("welcome overlay queue", () => {
  it("keeps the required product order and never overlaps stages", () => {
    expect(welcomeOverlayStages).toEqual([
      "onboarding",
      "existing-welcome",
      "shorts-event",
      "sidebar-navigation",
      "feedback",
      "done",
    ]);
    expect(nextWelcomeOverlayStage("onboarding")).toBe("existing-welcome");
    expect(nextWelcomeOverlayStage("existing-welcome")).toBe("shorts-event");
    expect(nextWelcomeOverlayStage("shorts-event")).toBe("sidebar-navigation");
    expect(nextWelcomeOverlayStage("sidebar-navigation")).toBe("feedback");
    expect(nextWelcomeOverlayStage("feedback")).toBe("done");
  });
});
