import { describe, expect, it } from "vitest";
import {
  projectActionGuideSteps,
  projectActionGuideStepsFor,
} from "./project-action-guide";

describe("project action guide", () => {
  it("guides all project actions before the completion step", () => {
    expect(projectActionGuideSteps.map((step) => step.id)).toEqual([
      "edit",
      "download",
      "bulk-download",
      "back",
      "complete",
    ]);
    expect(projectActionGuideSteps.at(-1)?.targetSelector).toBeNull();
  });

  it("skips unavailable project actions while retaining navigation and completion", () => {
    expect(projectActionGuideStepsFor({
      editAvailable: false,
      downloadAvailable: true,
      bulkDownloadAvailable: false,
    }).map((step) => step.id)).toEqual([
      "download",
      "back",
      "complete",
    ]);
  });
});
