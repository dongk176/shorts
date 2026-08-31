import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorApplyFailureNotice } from "./editor-apply-failure-notice";
import type { SiteLocale } from "@/lib/i18n/config";

describe("EditorApplyFailureNotice", () => {
  it("does not show an error for successful edits or pending retries", () => {
    expect(renderToStaticMarkup(createElement(EditorApplyFailureNotice, {
      failed: false,
      locale: "ko",
    }))).toBe("");
  });

  it.each<SiteLocale>(["ko", "en", "ja"])(
    "announces a safe edit failure in %s without submitting another render",
    (locale) => {
      const html = renderToStaticMarkup(createElement(EditorApplyFailureNotice, {
        failed: true,
        locale,
      }));

      expect(html).toContain('role="alert"');
      expect(html).toContain("data-i18n-skip");
      expect(html).not.toContain("<button");
      expect(html).not.toContain("<form");
      expect(html).not.toMatch(/renderSpec|rerender_batch|arn:aws|Traceback/);
      if (locale === "ko") {
        expect(html).toContain("편집 적용에 실패했습니다.");
        expect(html).toContain("기존 영상은 유지됩니다.");
        expect(html).toContain("다시 적용해 주세요.");
      } else if (locale === "en") {
        expect(html).toContain("The previous video is still available.");
      } else {
        expect(html).toContain("元の動画は保持されています。");
      }
    },
  );
});
