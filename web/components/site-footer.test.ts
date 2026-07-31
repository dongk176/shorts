import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_FOOTER_VISIBLE, TEAM_PAGE_VISIBLE } from "@/lib/site-visibility";

const footerSource = readFileSync(
  new URL("./site-footer.tsx", import.meta.url),
  "utf8",
);

describe("SiteFooter", () => {
  it("stays visible while the team page remains hidden", () => {
    expect(SITE_FOOTER_VISIBLE).toBe(true);
    expect(TEAM_PAGE_VISIBLE).toBe(false);
    expect(footerSource).toContain('<footer className="site-footer">');
  });
});
