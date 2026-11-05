import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RankingProjectList } from "@/components/ranking-project-list";
import { UsageProvider } from "@/components/usage-provider";
import { RankingIntroVideo } from "@/components/ranking-onboarding-preview";
import { RankingShowroom } from "@/components/ranking-showroom";
import { TemplateCommentPreview } from "@/components/template-comment-prototype";
import { I18nProvider } from "./provider";
import { messagesByLocale } from "./messages";
import { createUiText } from "./ui-text";
import uiCopy from "./ui-copy.json";
import { TEMPLATE_PRESET_COMMENT_SAMPLE } from "@/lib/template-config";
vi.mock("next/navigation", () => ({usePathname: () => "/", useRouter: () => ({})}));
function render(child: React.ReactNode, locale: "ko" | "en" | "ja") {
 return renderToStaticMarkup(<I18nProvider locale={locale} messages={messagesByLocale[locale]}>{child}</I18nProvider>);
}
describe("prepared localized showroom", () => {
 it.each(["en", "ja"] as const)("shows only 12 recommended %s examples with paired media", locale => {
  const html = render(<RankingShowroom />, locale);
  expect((html.match(/role="tab"/g) || []).length).toBe(12);
  expect(html).toContain(`/ranking-showroom-${locale}/dogs.mp4`);
  expect(html).toContain(`/ranking-showroom-${locale}/dogs.jpg`);
  expect(html).not.toContain("/soccer.mp4");
  expect(html).not.toMatch(/[가-힣]/);
  for (const copy of uiCopy) expect(createUiText(locale)(copy.ko)).toBe(copy[locale]);
 });
 it.each(["ko", "en", "ja"] as const)("connects the actual %s intro video to its matching poster", locale => {
  const html=render(<RankingIntroVideo />,locale);
  const folder=locale === "ko" ? "ranking-showroom-20" : `ranking-showroom-${locale}`;
  expect(html).toContain(`src="/${folder}/dogs.mp4"`);
  expect(html).toContain(`poster="/${folder}/dogs.jpg"`);
 });
 it.each(["en", "ja"] as const)("localizes untitled project fallback but retains authored titles in %s",locale=>{
  const project={id:"sample",title:null,createdAt:"2026-11-05T00:00:00Z",status:"draft" as const,operationId:null,duration:null,remoteUrl:null,busy:false};
  const wrap=(title:string|null)=>render(<UsageProvider initialState={{authenticated:false,accountId:null,isEnterprise:false,usage:null}}><RankingProjectList projects={[{...project,title}]}/></UsageProvider>,locale);
  expect(wrap(null)).toContain(locale==="en"?"Untitled ranking video":"無題のランキング動画");
  expect(wrap("내가 쓴 제목")).toContain("내가 쓴 제목");
  expect(wrap("내가 쓴 제목")).toContain('data-i18n-skip="true"');
 });
 it("preserves all Korean examples", () => {
  const html=render(<RankingShowroom />, "ko");
  expect((html.match(/role="tab"/g)||[]).length).toBe(20);
  expect(html).toContain("/ranking-showroom-20/");
 });
 it.each(["en", "ja"] as const)("localizes demo identity but preserves authored comments in %s", locale => {
  expect(render(<TemplateCommentPreview theme="dark" size="medium" />,locale)).not.toMatch(/[가-힣]/);
  const comment={...TEMPLATE_PRESET_COMMENT_SAMPLE,text:"내가 쓴 제목 없는 영상",nickname:"나의 채널",ageLabel:"내 날짜",initial:"나"};
  const html=render(<TemplateCommentPreview theme="dark" size="medium" comment={comment}/>,locale);
  expect(html).toContain(comment.text);expect(html).toContain(comment.nickname);expect(html).toContain(comment.ageLabel);
 });
});
