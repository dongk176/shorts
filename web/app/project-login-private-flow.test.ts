import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("project login return flow", () => {
  it("opens the login overlay for signed-out project list visitors", () => {
    const projectsPage = source("./projects/page.tsx");
    const loginGate = source("../components/project-login-gate.tsx");

    expect(projectsPage).toContain("autoOpen={!user}");
    expect(projectsPage).toContain('next={PAGE_PATH}');
    expect(loginGate).toContain("if (autoOpen && !user) setLoginOpen(true)");
  });

  it("returns a signed-out project visitor to the same owned project path", () => {
    const projectPage = source("./projects/[projectNumber]/page.tsx");
    const loginGate = source("../components/project-login-gate.tsx");

    expect(projectPage).toContain("<ProjectLoginRequiredPage projectNumber={projectNumber} />");
    expect(projectPage).toContain("getAuthenticatedProjectPageAccess");
    expect(projectPage).toContain("if (!projectAccess?.canAccess) notFound()");
    expect(projectPage).not.toContain("requireMvpSession");
    expect(loginGate).toContain("const next = `/projects/${projectNumber}`");
    expect(loginGate).toContain("같은 화면으로 바로 이어드릴게요");
  });
});

describe("EASYCUT PRIVATE entry", () => {
  it("adds a premium navigation entry below the standard links", () => {
    const header = source("../components/site-header.tsx");

    expect(header).toContain('href="/easycut-private"');
    expect(header).toContain("EASYCUT PRIVATE");
    expect(header).toContain('"easycut-private-nav nav-link"');
    expect(header).not.toContain("PRIVATE CHANNEL");
    expect(header).not.toContain("easycut-private-arrow");
    expect(header.indexOf('item.path === decodedPathname')).toBeLessThan(
      header.indexOf('href="/easycut-private"'),
    );
  });

  it("keeps the signed-in remaining-usage UI visible in the sidebar and mobile header", () => {
    const header = source("../components/site-header.tsx");
    const usageIndicator = source("../components/header-usage-indicator.tsx");
    const globalStyles = source("./globals.css");
    const sidebarStyles = source("./site-sidebar.css");

    expect(usageIndicator).toContain("header-usage-indicator");
    expect(usageIndicator).toContain('t("common.remainingMinutes", { minutes: displayedMinutes })');
    expect(usageIndicator).toContain("site-header-mobile-usage md:hidden");
    expect(usageIndicator).toContain("`남은 ${displayedMinutes}분`");
    expect(header).toContain("<HeaderUsageIndicator mobile />");
    expect(globalStyles).toContain(".site-header-mobile-usage");
    expect(sidebarStyles).toContain(".site-header-sidebar .header-usage-indicator span");
    expect(sidebarStyles).toContain("display: inline;");
  });

  it("renders the requested private-channel copy and Kakao entry CTA", () => {
    const privatePage = source("./easycut-private/page.tsx");
    const globalStyles = source("./globals.css");

    expect(privatePage).toContain("https://open.kakao.com/o/gBO91xHi");
    expect(privatePage).toContain("채팅방 입장");
    expect(privatePage).not.toContain("E·C·P 입장");
    expect(privatePage).toContain("이지컷의 좋은 것들을");
    expect(privatePage).toContain("활용하기 좋은 재사용 허용 영상부터");
    expect(privatePage).not.toContain("대표가 직접 고른");
    expect(privatePage).toContain("일반 공개 전에 가장 먼저 받아보실 수 있어요");
    expect(privatePage).toContain("여기서 먼저 확인해보세요");
    expect(privatePage).not.toContain("남들보다 한발 먼저,");
    expect(privatePage).toContain("PRIVATE에서 먼저 받아보는 것");
    expect(privatePage).toContain("영상 추천");
    expect(privatePage).not.toContain("영상 큐레이션");
    expect(privatePage).toContain("제작 노트");
    expect(privatePage).toContain("새 기능을 가장 먼저");
    expect(privatePage).toContain("text-white");
    expect(privatePage).toContain("easycut-private-icon-solid");
    expect(globalStyles).toContain("easycut-private-border-orbit");
    expect(privatePage).not.toContain("easycut-private-step-list");
    expect(privatePage).not.toContain('number: "01"');
    expect(globalStyles).toContain(".easycut-private-page { background: #101415; }");
    expect(globalStyles).toContain("linear-gradient(105deg,#9c65dc 0%,#bd5fc6 38%,#df617d 72%,#f06c5f 100%)");
    expect(globalStyles).not.toContain("background: rgba(254,229,0,.1);");
    expect(globalStyles).not.toContain(".easycut-private-page::after");
    expect(privatePage).not.toMatch(/#(?:d9c29a|e6d1a8|caae76|9d7d49|c7aa73)/i);
  });
});
