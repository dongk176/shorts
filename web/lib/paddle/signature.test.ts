import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyPaddleSignature } from "./signature";
describe("Paddle raw webhook authentication", () => {
  const now = 1790380800000,
    ts = String(now / 1000),
    raw = '{"a": 1}',
    secret = "test-secret";
  const digest = createHmac("sha256", secret)
    .update(`${ts}:${raw}`)
    .digest("hex");
  const header = `ts=${ts};h1=${digest}`;
  it("accepts exact bytes and signature rotation", () => {
    expect(verifyPaddleSignature(raw, header, secret, now)).toBe(true);
    expect(
      verifyPaddleSignature(
        raw,
        `ts=${ts};h1=${"0".repeat(64)};h1=${digest}`,
        secret,
        now,
      ),
    ).toBe(true);
  });
  it("rejects tampering, reserialization, stale and future signatures, missing secret and malformed hashes", () => {
    for (const [body, h, key, time] of [
      [raw.replace("1", "2"), header, secret, now],
      ['{"a":1}', header, secret, now],
      [raw, header, secret, now + 6000],
      [raw, header, secret, now - 6000],
      [raw, header, "", now],
      [raw, `ts=${ts};h1=abc`, secret, now],
      [raw, `ts=${ts};${header}`, secret, now],
    ] as const)
      expect(verifyPaddleSignature(body, h, key, time)).toBe(false);
  });
});
