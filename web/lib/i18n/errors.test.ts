import { describe, expect, it } from "vitest";
import { localizeApiError } from "./errors";

describe("localizeApiError", () => {
  it("does not render serialized validation details", () => {
    const detail = '[{"origin":"string","code":"too_small","path":["youtubeUrl"],"message":"Invalid input"}]';

    expect(localizeApiError({ detail }, 400, "ko")).toBe("입력 내용을 확인해 주세요.");
  });

  it("does not render an English server exception on the Korean site", () => {
    expect(
      localizeApiError({ detail: "Failed to fetch upstream response" }, 503, "ko"),
    ).toBe("서비스가 일시적으로 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
  });

  it("keeps a deliberate Korean explanation", () => {
    expect(
      localizeApiError({ detail: "올바른 YouTube 링크를 입력해 주세요." }, 400, "ko"),
    ).toBe("올바른 YouTube 링크를 입력해 주세요.");
  });

  it("keeps a deliberate Korean explanation for a generic HTTP error code", () => {
    expect(
      localizeApiError({
        detail: "댓글 노출 시간이 서로 겹치지 않게 조정해 주세요.",
        code: "HTTP_400",
      }, 400, "ko"),
    ).toBe("댓글 노출 시간이 서로 겹치지 않게 조정해 주세요.");
  });
});
