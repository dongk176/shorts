import { describe, expect, it } from "vitest";
import { editorHasChannelContrast } from "./channel-contrast";
import { UNIFIED_SNS_EDITOR_RELEASE_ID, UNIFIED_COMMUNITY_EDITOR_RELEASE_ID } from "./unified-sns-editor";

describe("identity-corrected social editor routing", () => {
  it("selects the request-binding verified successors and retains contrast", () => {
    expect(UNIFIED_SNS_EDITOR_RELEASE_ID).toBe("340f9382-c8b0-4926-acd0-b8a3987316e4");
    expect(UNIFIED_COMMUNITY_EDITOR_RELEASE_ID).toBe("0f39f8e7-f4e7-48d1-9c0e-7735276ae06b");
    for (const id of [UNIFIED_SNS_EDITOR_RELEASE_ID, UNIFIED_COMMUNITY_EDITOR_RELEASE_ID]) {
      expect(editorHasChannelContrast(id)).toBe(true);
    }
    expect(editorHasChannelContrast("unregistered-release")).toBe(false);
  });
});
