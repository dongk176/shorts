import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelConnectionsPage } from "./channel-connections-page";
vi.mock("@/lib/i18n/provider", () => ({ useI18n: () => ({ locale: "en" }) }));
vi.mock("./tiktok-publishing", () => ({ TikTokPublishingPanel: () => <section data-platform="tiktok"/> }));
vi.mock("./youtube-account-connections", () => ({ YoutubeAccountConnections: () => <section data-platform="youtube-existing"/> }));
describe("TikTok channel management", () => {
  it("shows the public TikTok panel only with the server grant and preserves the YouTube component", () => {
    const html = renderToStaticMarkup(<ChannelConnectionsPage tiktokEnabled/>);
    expect(html).toContain('data-platform="tiktok"');
    expect(html).toContain('data-platform="youtube-existing"');
    expect(html).toContain("Instagram · Threads");
    expect(html).not.toContain("Instagram · TikTok · Threads");
  });
  it("offers the approved Instagram project flow without advertising it as coming soon", () => {
    const html = renderToStaticMarkup(<ChannelConnectionsPage instagramEnabled tiktokEnabled/>);
    expect(html).toContain('aria-label="Instagram"');
    expect(html).toContain('href="/en/projects"');
    expect(html).toContain("Connect from a project");
    expect(html).not.toContain("Instagram · Threads");
    expect(html).toContain("Threads");
    expect(html).toContain('data-platform="youtube-existing"');
  });
  it("does not expose TikTok to an unrelated administrator grant or by default", () => {
    for (const props of [{}, { adminEnabled: true }]) {
      const html = renderToStaticMarkup(<ChannelConnectionsPage {...props}/>);
      expect(html).not.toContain('data-platform="tiktok"');
      expect(html).toContain("Instagram · TikTok · Threads");
    }
  });
});
