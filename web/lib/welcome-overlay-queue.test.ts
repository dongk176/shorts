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
      "feedback",
      "done",
    ]);
    expect(nextWelcomeOverlayStage("onboarding")).toBe("existing-welcome");
    expect(nextWelcomeOverlayStage("existing-welcome")).toBe("sidebar-navigation");
    expect(nextWelcomeOverlayStage("sidebar-navigation")).toBe("feedback");
    expect(nextWelcomeOverlayStage("shorts-event")).toBe("feedback");
    expect(nextWelcomeOverlayStage("feedback")).toBe("done");
  });
});
