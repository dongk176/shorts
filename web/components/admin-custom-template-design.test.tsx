import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/admin/easycutcutcutcutcutcut/custom-template-design-actions", () => ({
  setCustomTemplateDesignMode: vi.fn(),
}));
import { AdminCustomTemplateDesign } from "@/components/admin-custom-template-design";

function render(readyForAdmin: boolean, readyForPublic: boolean) {
  return renderToStaticMarkup(createElement(AdminCustomTemplateDesign, {
    mode: "off", readyForAdmin, readyForPublic,
    readinessMessage: "새 렌더 검증이 아직 완료되지 않았습니다.",
  }));
}

function button(html: string, mode: string) {
  return html.match(new RegExp(`<button[^>]*value="${mode}"[^>]*>`))?.[0];
}
const disabledAttribute = /\sdisabled(?:=|\s|>)/;

describe("administrator custom template design controls", () => {
  it("keeps OFF selectable even when every readiness check is blocked", () => {
    const html = render(false, false);
    expect(button(html, "off")).not.toMatch(disabledAttribute);
    expect(button(html, "admin")).toMatch(disabledAttribute);
    expect(button(html, "public")).toMatch(disabledAttribute);
    expect(html).toContain("새 렌더 검증이 아직 완료되지 않았습니다.");
  });

  it("opens administrator testing without claiming public readiness", () => {
    const html = render(true, false);
    expect(button(html, "admin")).not.toMatch(disabledAttribute);
    expect(button(html, "public")).toMatch(disabledAttribute);
    expect(html).not.toContain('type="checkbox"');
  });

  it("allows public selection only after server-provided readiness", () => {
    const html = render(true, true);
    expect(button(html, "public")).not.toMatch(disabledAttribute);
    expect(html).toContain("기존 이용 권한에 따라 제공");
    expect(html).toContain("다운로드 영상 확인 후 공개");
    expect(html).toContain("자동 확인은 서버의 생성·재편집 완료 기록을 검사합니다.");
    expect(html).toContain("미리보기와 직접 비교한 뒤 공개 버튼을 눌러 주세요.");
  });

  it("states that stopping new use preserves saved assets and existing manual text", () => {
    const html = render(false, false);
    expect(html).toContain("이미 만든 영상, 보관한 배경, 진행 중 작업은 유지");
    expect(html).toContain("기존 편집기의 수동 텍스트 기능은 계속 사용할 수 있습니다.");
  });
});
