import { describe, expect, it } from "vitest";
import { z } from "zod";
import { apiError, HttpError } from "./http";

describe("apiError", () => {
  it("turns validation internals into a short Korean prompt", async () => {
    const validation = z.object({ youtubeUrl: z.string().min(1) }).safeParse({
      youtubeUrl: "",
    });
    if (validation.success) throw new Error("테스트 입력이 검증에 실패해야 합니다.");

    const response = apiError(validation.error);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      detail: "입력한 내용을 다시 확인해 주세요.",
      code: "INVALID_INPUT",
    });
  });

  it("does not expose an unexpected English exception", async () => {
    const response = apiError(new Error("upstream connection reset"));

    await expect(response.json()).resolves.toMatchObject({
      detail: "요청을 처리하지 못했습니다.",
    });
  });

  it("keeps an explicitly public HttpError message", async () => {
    const response = apiError(
      new HttpError(409, "이미 처리 중인 작업이 있습니다.", "JOB_IN_PROGRESS"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      detail: "이미 처리 중인 작업이 있습니다.",
      code: "JOB_IN_PROGRESS",
    });
  });
});
