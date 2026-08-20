import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(
  new URL("./pricing-page-shell.tsx", import.meta.url),
  "utf8",
);
const tossSource = readFileSync(
  new URL("./toss-pricing-client.tsx", import.meta.url),
  "utf8",
);

describe("guest Toss pricing", () => {
  it("shows the public Toss catalog only while rollout and charges are enabled", () => {
    expect(pageSource).toContain("if (!user)");
    expect(pageSource).toContain(
      "runtime.effective.assignments && runtime.effective.charges",
    );
    expect(pageSource).toContain("guestTossCatalog = publicTossCatalog()");
  });

  it("opens the existing login dialog from a guest plan CTA", () => {
    expect(shellSource).toContain("guestCatalog={guestTossCatalog}");
    expect(shellSource).toContain("onRequireLogin={() => setLoginOpen(true)}");
    expect(tossSource).toMatch(
      /if \(guestCatalog\) \{\s*onRequireLogin\(\);\s*return;/,
    );
  });

  it("does not call authenticated Toss state or load its SDK for guests", () => {
    expect(tossSource).toContain("if (initialState || guestCatalog) return;");
    expect(tossSource).toContain("!guestCatalog ? (");
    expect(tossSource).toContain("state?.catalog ?? guestCatalog ?? []");
    expect(tossSource).toContain("const loading = !state && !guestCatalog;");
  });
});
