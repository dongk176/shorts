import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overlaySource = readFileSync(
  new URL("./shorts-creation-event-overlay.tsx", import.meta.url),
  "utf8",
);
const shortsAppSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);

describe("shorts creation event overlay", () => {
  it("checks campaign eligibility without showing the three-step welcome", () => {
    expect(overlaySource).not.toContain("/campaigns/shorts-10k/event-open.png");
    expect(overlaySource).not.toContain("/campaigns/shorts-10k/reward-50-minutes.png");
    expect(overlaySource).not.toContain("/campaigns/shorts-10k/how-to-join.png");
    expect(overlaySource).not.toContain("ShortsEventWelcomeOverlay");
    expect(overlaySource).toContain("이벤트 참여 완료!");
    expect(overlaySource).toContain("이 지급되었습니다");
    expect(overlaySource).toContain("return null;");
  });

  it("does not rely on browser storage for account-wide one-time presentation", () => {
    expect(overlaySource).not.toMatch(/\bfetch\s*\(/);
    expect(overlaySource).not.toContain("requestJson");
    expect(overlaySource).not.toContain("localStorage");
    expect(overlaySource).not.toContain("sessionStorage");
    expect(overlaySource).toContain("claimShortsThankYouEvent");
    expect(overlaySource).toContain('useWelcomeOverlayStage("shorts-event")');
    expect(overlaySource).toContain("completeQueueStage();");
  });

  it("shows completion only when the job response confirms a real grant", () => {
    expect(shortsAppSource).toContain(
      "ShortsEventWelcomeController",
    );
    expect(shortsAppSource).toMatch(
      /if \(value\.shortsThankYouEventReward\.granted\) \{[\s\S]*?setShortsEventParticipationOpen\(true\)/,
    );
    expect(shortsAppSource.indexOf('>("/api/jobs"')).toBeLessThan(
      shortsAppSource.indexOf("setShortsEventParticipationOpen(true)"),
    );
  });
});
