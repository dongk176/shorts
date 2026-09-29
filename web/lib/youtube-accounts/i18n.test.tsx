import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/provider";
import { messagesByLocale } from "@/lib/i18n/messages";
import { YoutubeAccountUpload } from "@/components/youtube-account-upload";
import { createYoutubeText, youtubeCopy, youtubeMessage } from "./i18n";
import { privacyResult } from "./visibility";
vi.mock("next/navigation",()=>({usePathname:()=>"/projects/1",useRouter:()=>({})}));

describe("publishing language",()=>{
 it.each(["en","ja"] as const)("renders %s controls before effects and preserves authored content",locale=>{
  const render=(title:string,channelTitle:string)=>renderToStaticMarkup(<I18nProvider locale={locale} messages={messagesByLocale[locale]}><YoutubeAccountUpload shortId="test" title={title} connections={[{id:"c",channelId:"channel",channelTitle,status:"active"}]} onManage={()=>{}}/></I18nProvider>);
  expect(render("Sample video","My channel")).not.toMatch(/[가-힣]/);
  const authored=render("공개","연결됨");
  expect(authored).toContain('value="공개"');
  expect(authored).toContain('role="combobox"');
  expect(authored).toContain("<span>연결됨</span>");
  expect(authored).toContain(locale==="en"?"Destination channel":"投稿先チャンネル");
 });
 it("renders countdown, privacy result and errors in the current language",()=>{
  expect(createYoutubeText("en")("연결 대기 {seconds}초",{seconds:12})).toBe("Connect in 12s");
  expect(privacyResult("public","private","en")).toBe("Requested: Public · YouTube confirmed: Private");
  expect(privacyResult("private",null,"ja")).toBe("YouTube の公開設定は未確認です");
  expect(youtubeMessage("채널이 연결되었습니다.","en")).toBe("Your channel is connected.");
  expect(youtubeMessage("private unknown provider failure", "en")).not.toContain("provider");
 });
 it("supplies both translations with matching placeholders",()=>{
  const placeholders=(s:string)=>s.match(/\{\w+\}/g)?.sort()||[];
  for(const [ko,translations] of Object.entries(youtubeCopy))for(const translated of translations){
   expect(translated).not.toMatch(/[가-힣]/);
   expect(placeholders(translated)).toEqual(placeholders(ko));
  }
 });
});
