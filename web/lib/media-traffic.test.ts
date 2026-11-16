import { describe, it, expect } from "vitest";
import {
  trafficEventSchema,
  trafficEnvironment,
  formatTrafficBytes,
} from "./media-traffic";
import { browserTrafficBytes } from "./media-traffic-browser";
describe("traffic measurements", () => {
  it("does not call an opaque cross-origin request a zero-byte cache hit", () => {
    expect(
      browserTrafficBytes({
        responseStart: 0,
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 0,
      }),
    ).toBeNull();
    expect(
      browserTrafficBytes({
        responseStart: 1,
        transferSize: 300,
        encodedBodySize: 0,
        decodedBodySize: 0,
      }),
    ).toBeNull();
    expect(
      browserTrafficBytes({
        responseStart: 1,
        transferSize: 0,
        encodedBodySize: 1000,
        decodedBodySize: 1000,
      }),
    ).toBe(0);
    expect(
      browserTrafficBytes({
        responseStart: 1,
        transferSize: 1300,
        encodedBodySize: 1000,
        decodedBodySize: 1000,
      }),
    ).toBe(1000);
  });
  it("bounds payloads and separates unmeasured values", () => {
    expect(formatTrafficBytes(null)).toBe("미측정");
    expect(formatTrafficBytes(0)).toBe("0 B");
    expect(trafficEnvironment("shorts-test.vercel.app")).toBe("candidate");
    expect(trafficEnvironment("www.easycut.co.kr")).toBe("production");
    expect(
      trafficEventSchema.safeParse({
        id: crypto.randomUUID(),
        resource: "a",
        purpose: "home_example",
        bytes: -1,
      }).success,
    ).toBe(false);
  });
});
