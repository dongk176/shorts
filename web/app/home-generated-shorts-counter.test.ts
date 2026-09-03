import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(
  new URL("./shorts-app.tsx", import.meta.url),
  "utf8",
);

describe("home metric toggle", () => {
  it("provides both the reusable-video view schedule and generated-shorts total", () => {
    expect(homeSource).toContain("<ReusableViewCounter");
    expect(homeSource).toContain("counter={state?.reusableViewCounter ?? null}");
    expect(homeSource).toContain("generatedShortCount={state?.generatedShortCount ?? null}");
    expect(homeSource).not.toContain("initialValue={14_259}");
  });
});
