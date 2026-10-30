import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "./provider";
import { messagesByLocale, interpolateMessage } from "./messages";
import { createUiText } from "./ui-text";
import { localizedHref, isLocalizedPage } from "./routing";
import { translateLegacyText } from "./legacy-phrases";
import { sortRankingExamples } from "../ranking-examples";
import examples from "@/data/ranking-examples.json";
import { PaddlePricing } from "@/components/paddle-pricing";
import { CreditAllowance } from "@/components/credit-info";
import { RankingStudio } from "@/app/ranking-shorts/ranking-studio";
import { UsageProvider } from "@/components/usage-provider";
import { defaultRankingDraft, rankingDraftHasContent } from "../ranking-draft";
vi.mock("next/navigation",()=>({usePathname:()=>"/en/ranking-shorts",useRouter:()=>({})}));
function render(child:React.ReactNode, locale:"en"|"ja"="en"){return renderToStaticMarkup(<I18nProvider locale={locale} messages={messagesByLocale[locale]}><UsageProvider initialState={{authenticated:false,accountId:null,isEnterprise:false,usage:null}}>{child}</UsageProvider></I18nProvider>)}
describe("ranking English and Credit release",()=>{
 it.each(["en","ja"] as const)("includes Credit explanations on overseas %s pricing cards",locale=>{const html=render(<PaddlePricing locale={locale} loggedIn={false} onRequireLogin={()=>{}}/>,locale);expect((html.match(/>Credit</g)||[]).length).toBe(3);expect(html).toContain("200");expect(html).not.toContain("source-video minutes each month")});
 it("translates multiline reset copy without changing user content",()=>{expect(createUiText("en")("입력한 제목, 영상, 선택 구간과 소리 설정이 모두 초기화됩니다.\n이미 제작한 프로젝트는 그대로 남아 있어요.")).not.toMatch(/[가-힣]/)});
 it("keeps localized project destinations and authentication returns",()=>{expect(isLocalizedPage('/ranking-shorts')).toBe(true);expect(localizedHref('/ranking-shorts?project=example','en')).toBe('/en/ranking-shorts?project=example');expect(localizedHref('/auth/sign-in?next=%2Franking-shorts','en')).toContain('next=%2Fen%2Franking-shorts')});
 it("prioritizes the reader's language before view count",()=>{expect(sortRankingExamples(examples.items,'en')[0].language).toBe('영어');expect(sortRankingExamples(examples.items,'ko')[0].language).toBe('한국어')});
 it("renders the English workspace before hydration",()=>{const html=render(<RankingStudio ownerId="00000000-0000-0000-0000-000000000000" refreshedDesign/>);for(const text of ['Design settings','Scenes by rank','Video link or file','Create video'])expect(html).toContain(text);expect(html).not.toContain('순위별 장면');expect(html).toContain("Today&#x27;s ranking")});
 it("does not treat an untouched English default as user content",()=>{expect(rankingDraftHasContent(defaultRankingDraft('en'))).toBe(false);expect(rankingDraftHasContent({...defaultRankingDraft('en'),title:'My own title'})).toBe(true)});
 it("explains Credit through an accessible button without changing the allowance",()=>{const html=render(<CreditAllowance minutes={200}/>);expect(html).toContain('200');expect(html).toContain('Credit');expect(html).toContain('aria-haspopup="dialog"');expect(html).not.toContain('원본 영상 처리')});
 it("avoids a Korean particle after a variable duration",()=>{const text=interpolateMessage(messagesByLocale.ko['home.insufficientTime'],{duration:'1시간 0분',remaining:'20분 0초'});expect(text).not.toContain('분가');expect(text).toBe("선택한 구간(1시간 0분)이 남은 처리시간(20분 0초)을 초과해요. 구간을 줄여 주세요.");expect(translateLegacyText('양쪽 손잡이를 드래그해 쇼츠를 만들 범위를 정하세요. 4분부터 60분까지 선택할 수 있습니다.','en')).toContain('turn into Shorts')});
});
