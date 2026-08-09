import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { DOWNLOAD_RESPONSE_HEADERS_FUNCTION_CODE } from "../lib/cloudfront-functions";

type Query = Record<string, { value: string }>;

function runDownloadResponseFunction(querystring: Query) {
  const event = {
    request: { querystring },
    response: { statusCode: 200, headers: {} },
  };
  return runInNewContext(
    `${DOWNLOAD_RESPONSE_HEADERS_FUNCTION_CODE}; handler(event)`,
    { event },
  ) as { headers: Record<string, { value: string }> };
}

describe("CloudFront download response headers", () => {
  it("restores a percent-encoded Korean hook title for downloads", () => {
    const response = runDownloadResponseFunction({
      download: { value: "1" },
      filename: { value: encodeURIComponent("후킹 제목.mp4") },
    });

    expect(response.headers["content-disposition"].value).toBe(
      `attachment; filename="short.mp4"; filename*=UTF-8''${encodeURIComponent("후킹 제목.mp4")}`,
    );
  });

  it("supplies the hook title to native video saves without forcing a download", () => {
    const response = runDownloadResponseFunction({
      filename: { value: encodeURIComponent("일본어 タイトル.mp4") },
    });

    expect(response.headers["content-disposition"].value).toContain("inline;");
    expect(response.headers["content-disposition"].value).toContain(
      `filename*=UTF-8''${encodeURIComponent("일본어 タイトル.mp4")}`,
    );
  });

  it("rejects malformed or path-like names and uses a neutral fallback", () => {
    const malformed = runDownloadResponseFunction({
      download: { value: "1" },
      filename: { value: "%E0%A4%A" },
    });
    const pathLike = runDownloadResponseFunction({
      download: { value: "1" },
      filename: { value: encodeURIComponent("../private.mp4") },
    });

    expect(malformed.headers["content-disposition"].value).toBe(
      `attachment; filename="short.mp4"`,
    );
    expect(pathLike.headers["content-disposition"].value).toBe(
      `attachment; filename="short.mp4"`,
    );
  });
});
