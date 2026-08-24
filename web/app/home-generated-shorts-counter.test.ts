import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(
  new URL("./shorts-app.tsx", import.meta.url),
  "utf8",
);

describe("home generated shorts counter", () => {
  it("animates positive totals from one instead of a fixed historical total", () => {
    expect(homeSource).toContain("const startingValue = target > 0 ? 1 : 0;");
    expect(homeSource).not.toContain("initialValue={14_259}");
  });
});
