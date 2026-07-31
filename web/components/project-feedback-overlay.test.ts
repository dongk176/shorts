import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overlaySource = readFileSync(
  new URL("./project-feedback-overlay.tsx", import.meta.url),
  "utf8",
);

describe("ProjectFeedbackOverlay", () => {
  it("cannot be postponed before feedback is submitted", () => {
    expect(overlaySource).not.toContain("나중에 할게요");
    expect(overlaySource).not.toContain("/api/project-feedback/dismiss");
    expect(overlaySource).not.toContain("deferFeedback");
    expect(overlaySource).toContain('type="submit"');
    expect(overlaySource).toContain(
      "disabled={submitting || satisfactionRating === null || disappointmentReason === null}",
    );
  });
});
