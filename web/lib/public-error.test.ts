import { describe, expect, it } from "vitest";
import {
  safeUserFacingErrorMessage,
  userFacingErrorMessage,
} from "./public-error";

describe("user-facing error messages", () => {
  it("keeps a plain Korean explanation", () => {
    expect(safeUserFacingErrorMessage("영상 정보를 확인하지 못했습니다.")).toBe(
      "영상 정보를 확인하지 못했습니다.",
    );
  });

  it("blocks serialized validation details and technical English errors", () => {
    const zodDetail = '[{"origin":"string","code":"too_small","path":["youtubeUrl"],"message":"Invalid input"}]';

    expect(safeUserFacingErrorMessage(zodDetail)).toBeNull();
    expect(
      userFacingErrorMessage(
        new TypeError("Failed to fetch"),
        "서버에 연결하지 못했습니다.",
      ),
    ).toBe("서버에 연결하지 못했습니다.");
  });

  it("does not show an English exception in a Korean error area", () => {
    expect(
      userFacingErrorMessage(
        "upstream request was rejected",
        "요청을 처리하지 못했습니다.",
      ),
    ).toBe("요청을 처리하지 못했습니다.");
  });

  it("blocks environment names even when the surrounding sentence is Korean", () => {
    expect(
      userFacingErrorMessage(
        "YOUTUBE_API_KEY가 설정되지 않았습니다.",
        "영상 정보를 확인하지 못했습니다.",
      ),
    ).toBe("영상 정보를 확인하지 못했습니다.");
  });
});
