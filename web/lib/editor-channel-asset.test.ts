import { describe, expect, it } from "vitest";
import { parseEditorChannelImageDataUrl } from "./aws";

describe("editor channel image asset validation", () => {
  it("accepts a signed PNG payload", () => {
    const bytes = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      Buffer.alloc(40),
    ]);
    const result = parseEditorChannelImageDataUrl(
      `data:image/png;base64,${bytes.toString("base64")}`,
    );
    expect(result.contentType).toBe("image/png");
    expect(result.extension).toBe("png");
  });

  it("rejects a MIME label that does not match the bytes", () => {
    const bytes = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      Buffer.alloc(40),
    ]);
    expect(() => parseEditorChannelImageDataUrl(
      `data:image/jpeg;base64,${bytes.toString("base64")}`,
    )).toThrow("파일 형식");
  });
});
