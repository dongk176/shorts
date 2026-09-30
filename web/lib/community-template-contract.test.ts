import { describe, expect, it } from "vitest";
import { communityHeadingColor } from "./community-template-contract";

describe("community heading contrast", () => {
  it.each([
    ["#FF715E", "#FFFFFF"], ["#FF4D4F", "#FFFFFF"], ["#35E6E3", "#000000"],
    ["#3B82F6", "#FFFFFF"], ["#303E78", "#FFFFFF"], ["#FFD84D", "#000000"],
    ["#8BFF5A", "#000000"], ["#A78BFA", "#000000"],
    [" #35e6e3 ", "#000000"], ["#8bff5a", "#000000"], ["#a78bfa", "#000000"],
    ["#FFFFFF", "#000000"], ["bad", "#FFFFFF"],
  ])("uses the renderer's heading color for %s", (background, expected) => {
    expect(communityHeadingColor(background)).toBe(expected);
  });
});
