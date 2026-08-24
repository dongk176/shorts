import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("project feedback deferral API", () => {
  it("rejects every attempt to postpone required feedback", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      detail: "피드백은 나중에 할 수 없습니다. 피드백을 작성해 주세요.",
    });
  });
});
