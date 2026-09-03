import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cardSource = readFileSync(new URL("./project-card.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../app/shorts-app.tsx", import.meta.url), "utf8");
const projectsSource = readFileSync(new URL("../app/projects/page.tsx", import.meta.url), "utf8");
const projectListSource = readFileSync(new URL("./project-list.tsx", import.meta.url), "utf8");

describe("mobile project card containment", () => {
  it("keeps each card and its metadata inside the mobile column", () => {
    expect(cardSource).toContain("w-full min-w-0 max-w-full");
    expect(cardSource).toContain("flex min-w-0 flex-wrap");
    expect(cardSource).toContain("min-w-0 break-words");
  });

  it("uses one minmax-zero column on both project lists", () => {
    const mobileColumn = "grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2 lg:grid-cols-3";
    expect(homeSource).toContain(mobileColumn);
    expect(projectsSource).toContain("<ProjectList");
    expect(projectListSource).toContain(mobileColumn);
  });
});
