import { describe, expect, it } from "vitest";
import {
  nextWelcomeOverlayStage,
  welcomeOverlayStages,
} from "./welcome-overlay-queue";

describe("welcome overlay queue", () => {
  it("keeps the retired event type-compatible while skipping it in the active queue", () => {
    expect(welcomeOverlayStages).toEqual([
      "onboarding",
      "existing-welcome",
      "sidebar-navigation",
      "shorts-event",
      "marketing-email",
      "feedback",
      "done",
    ]);
    expect(nextWelcomeOverlayStage("onboarding")).toBe("existing-welcome");
    expect(nextWelcomeOverlayStage("existing-welcome")).toBe("sidebar-navigation");
    expect(nextWelcomeOverlayStage("sidebar-navigation")).toBe("marketing-email");
    expect(nextWelcomeOverlayStage("shorts-event")).toBe("marketing-email");
    expect(nextWelcomeOverlayStage("marketing-email")).toBe("feedback");
    expect(nextWelcomeOverlayStage("feedback")).toBe("done");
  });
});
