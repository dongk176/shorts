import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyYoutubePlaybackResponse,
  parseInitialPlayerResponse,
  verifyYoutubePlaybackAvailability,
} from "./youtube-playback";

function playableResponse(streamingData: Record<string, unknown> = {
  formats: [{ signatureCipher: "url=https%3A%2F%2Fexample.com%2Fvideo" }],
}) {
  return {
    playabilityStatus: { status: "OK", playableInEmbed: true },
    streamingData,
  };
}

function htmlFor(playerResponse: Record<string, unknown>) {
  return `<html><script>ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script></html>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("YouTube direct playback availability", () => {
  it("parses the balanced initial player JSON from the watch page", () => {
    const parsed = parseInitialPlayerResponse(htmlFor({
      ...playableResponse(),
      videoDetails: { title: "brace } and quoted \\\" text" },
    }));

    expect(parsed.playabilityStatus).toEqual({ status: "OK", playableInEmbed: true });
  });

  it.each([
    ["LOGIN_REQUIRED", "Sign in to watch this video", "authentication_required"],
    ["LOGIN_REQUIRED", "This video is age-restricted. Confirm your age", "age_restricted"],
    ["AGE_VERIFICATION_REQUIRED", "", "age_restricted"],
    ["UNPLAYABLE", "This is a members-only video. Join this channel", "members_only"],
    ["UNPLAYABLE", "Purchase this content to watch", "paid_content"],
    ["UNPLAYABLE", "This video is not available in your country", "region_restricted"],
    ["ERROR", "This video has been removed by the uploader", "removed"],
    ["ERROR", "This video is no longer available due to a copyright claim", "copyright_restricted"],
    ["LIVE_STREAM_OFFLINE", "This live event will begin soon", "not_yet_available"],
  ])("classifies %s / %s as %s", (status, reason, code) => {
    expect(classifyYoutubePlaybackResponse({
      playabilityStatus: { status, reason },
    })).toMatchObject({ creationAllowed: false, creationBlockCode: code });
  });

  it("does not confuse YouTube's bot challenge with an account-only video", () => {
    expect(classifyYoutubePlaybackResponse({
      playabilityStatus: {
        status: "LOGIN_REQUIRED",
        reason: "Sign in to confirm you're not a bot",
      },
    })).toMatchObject({
      creationAllowed: false,
      creationBlockCode: "bot_challenge",
    });
  });

  it("allows a usable format when external playback is disabled", () => {
    expect(classifyYoutubePlaybackResponse({
      ...playableResponse(),
      playabilityStatus: { status: "OK", playableInEmbed: false },
    })).toEqual({
      creationAllowed: true,
      creationBlockCode: null,
      creationBlockReason: null,
    });
  });

  it("blocks DRM-only playback formats", () => {
    expect(classifyYoutubePlaybackResponse(playableResponse({
      licenseInfos: [{ drmFamily: "WIDEVINE" }],
      formats: [{
        signatureCipher: "url=https%3A%2F%2Fexample.com%2Fvideo",
        drmFamilies: ["WIDEVINE"],
      }],
    }))).toMatchObject({ creationAllowed: false, creationBlockCode: "drm_protected" });
  });

  it("fails closed when OK playback has no usable media locator", () => {
    expect(classifyYoutubePlaybackResponse(playableResponse({ formats: [] }))).toMatchObject({
      creationAllowed: false,
      creationBlockCode: "playback_unavailable",
    });
  });

  it("allows a non-DRM format even when the response also contains DRM formats", () => {
    expect(classifyYoutubePlaybackResponse(playableResponse({
      licenseInfos: [{ drmFamily: "WIDEVINE" }],
      formats: [
        {
          signatureCipher: "url=https%3A%2F%2Fexample.com%2Fdrm",
          drmFamilies: ["WIDEVINE"],
        },
        { signatureCipher: "url=https%3A%2F%2Fexample.com%2Fclear" },
      ],
    }))).toEqual({
      creationAllowed: true,
      creationBlockCode: null,
      creationBlockReason: null,
    });
  });

  it("checks the ordinary YouTube watch page directly without a proxy option", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(htmlFor(playableResponse()), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyYoutubePlaybackAvailability("dQw4w9WgXcQ")).resolves.toMatchObject({
      creationAllowed: true,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&hl=en",
    );
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("dispatcher");
  });
});
