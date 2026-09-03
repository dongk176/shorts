import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(
  new URL("./shorts-app.tsx", import.meta.url),
  "utf8",
);

describe("home reusable view counter", () => {
  it("uses the reusable-video view schedule instead of the generated-shorts total", () => {
    expect(homeSource).toContain("<ReusableViewCounter");
    expect(homeSource).toContain("counter={state?.reusableViewCounter ?? null}");
    expect(homeSource).not.toContain("state?.generatedShortCount");
    expect(homeSource).not.toContain("initialValue={14_259}");
  });
});
