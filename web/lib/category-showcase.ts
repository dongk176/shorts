import { showcaseAsset } from "./showcase-delivery";
import type { SiteLocale } from "@/lib/i18n/config";

export type ShowcaseCategory = "talk" | "entertainment" | "review" | "education" | "gaming" | "vlog";
export type ShowcaseStyle = "highlight" | "pop" | "paper" | "white" | "minimal" | "comment" | "dark";
type Copy = Record<SiteLocale, string>;
export const categoryShowcase = [
  { id: "talk", label: { ko: "인터뷰·토크", en: "Interviews & Podcasts", ja: "トーク・インタビュー" }, styles: ["highlight", "highlight", "paper"] },
  { id: "entertainment", label: { ko: "예능·챌린지", en: "Entertainment", ja: "バラエティ・チャレンジ" }, styles: ["pop", "pop", "comment"] },
  { id: "review", label: { ko: "정보·리뷰", en: "Explainers & Reviews", ja: "情報・レビュー" }, styles: ["white", "white", "minimal"] },
  { id: "education", label: { ko: "교육·강의", en: "Education & Tutorials", ja: "学び・講座" }, styles: ["white", "white", "highlight"] },
  { id: "gaming", label: { ko: "게임·스트리밍", en: "Gaming & Streams", ja: "ゲーム・配信" }, styles: ["minimal", "minimal", "comment"] },
  { id: "vlog", label: { ko: "브이로그·일상", en: "Vlogs & Lifestyle", ja: "Vlog・日常" }, styles: ["highlight", "highlight", "paper"] },
] satisfies { id: ShowcaseCategory; label: Copy; styles: [ShowcaseStyle, ShowcaseStyle, ShowcaseStyle] }[];

export const showcaseCategoryCopy: Record<ShowcaseCategory, Record<SiteLocale, { headline: string; description: string }>> = {
  "talk": {
    "ko": {
      "headline": "대화의 핵심만 짧게!",
      "description": "티키타카부터 솔직한 한마디까지, 대화의 흐름을 살려 편집합니다"
    },
    "en": {
      "headline": "Conversation highlights",
      "description": "We’ll turn the best parts of your conversation into Shorts"
    },
    "ja": {
      "headline": "トークの見どころを短く",
      "description": "軽いやり取りから本音まで、会話の流れを活かしてショートに仕上げます。"
    }
  },
  "entertainment": {
    "ko": {
      "headline": "웃긴 장면만 모아서!",
      "description": "리액션부터 예상 못 한 반전까지, 재밌는 장면을 골라 담습니다"
    },
    "en": {
      "headline": "The funniest moments",
      "description": "We’ll bring the reactions, surprises and funniest moments together"
    },
    "ja": {
      "headline": "笑える場面をまとめて",
      "description": "リアクションも予想外の展開も、面白いところをぎゅっとまとめます"
    }
  },
  "review": {
    "ko": {
      "headline": "리뷰는 핵심만 쏙!",
      "description": "써본 느낌부터 장단점까지, 궁금한 포인트를 짧게 정리합니다"
    },
    "en": {
      "headline": "Reviews at a glance",
      "description": "We’ll condense the hands-on details and verdict into a quick Short"
    },
    "ja": {
      "headline": "レビューの要点をひと目で",
      "description": "使ってみた感想から長所・短所まで、気になるポイントを短くまとめます"
    }
  },
  "education": {
    "ko": {
      "headline": "긴 강의도 핵심만!",
      "description": "중요한 내용은 눈에 띄게, 설명은 따라가기 쉽게 편집합니다"
    },
    "en": {
      "headline": "Lessons made concise",
      "description": "We’ll highlight the key points and make each step easy to follow"
    },
    "ja": {
      "headline": "長い講義もコンパクトに",
      "description": "大事なところを見やすく、説明の流れもわかりやすく整えます"
    }
  },
  "gaming": {
    "ko": {
      "headline": "플레이도 리액션도 한 번에!",
      "description": "결정적인 플레이부터 생생한 리액션까지, 한 편에 담습니다"
    },
    "en": {
      "headline": "Plays and reactions together",
      "description": "We’ll keep the big play and your reaction together in one Short"
    },
    "ja": {
      "headline": "プレイもリアクションも一緒に",
      "description": "決めた瞬間からリアクションまで、一本のショートにまとめます"
    }
  },
  "vlog": {
    "ko": {
      "headline": "브이로그도 짧고 재밌게!",
      "description": "먹고 놀고 돌아다닌 하루, 다시 보고 싶은 장면을 쇼츠로 만듭니다"
    },
    "en": {
      "headline": "Your vlog in highlights",
      "description": "We’ll turn your day’s favorite moments into a Short worth replaying"
    },
    "ja": {
      "headline": "Vlogの見どころをまとめて",
      "description": "お出かけも何気ない日常も、また見たい場面を集めてショートに仕上げます"
    }
  }
};

export const showcaseStyleLabels: Record<ShowcaseStyle, Copy> = {
  dark: { ko: "다크 레드", en: "Dark red", ja: "ダークレッド" },
  highlight: { ko: "자막 강조형", en: "Highlight captions", ja: "強調字幕" },
  pop: { ko: "자막 팝형", en: "Pop captions", ja: "ポップ字幕" },
  paper: { ko: "페이퍼", en: "Paper", ja: "ペーパー" },
  white: { ko: "화이트 옐로", en: "White & yellow", ja: "ホワイト・イエロー" },
  minimal: { ko: "기본형", en: "Basic", ja: "ベーシック" },
  comment: { ko: "댓글 캡처", en: "Comment overlay", ja: "コメント風" },
};

export type ShowcaseMedia = {
  id: string;
  source: string;
  poster: string;
  title: string;
  author: string;
  headline: string;
  description: string;
  originalUrl?: string;
  hasAudio?: boolean;
  shorts: [ShowcaseShort, ShowcaseShort, ShowcaseShort];
};
export type ShowcaseShort = { source: string; poster: string; style: ShowcaseStyle };
function curatedShorts(id: string): ShowcaseMedia["shorts"] {
  const styles: [ShowcaseStyle, ShowcaseStyle, ShowcaseStyle] = ["comment", "highlight", "minimal"];
  const clip = (index: number): ShowcaseShort => ({ source: showcaseAsset(`${id}-${index + 1}`, "video"), poster: showcaseAsset(`${id}-${index + 1}`, "poster"), style: styles[index] });
  return [clip(0), clip(1), clip(2)];
}
export const categoryShowcaseMedia: Record<SiteLocale, Partial<Record<ShowcaseCategory, ShowcaseMedia>>> = {
  ko: {
    vlog: {"id": "ko-vlog", "headline": "브이로그·일상", "description": "하루 종일 찍고, 보고 싶은 순간만", "source": showcaseAsset("ko-vlog-source", "video"), "poster": showcaseAsset("ko-vlog-source", "poster"), "title": "EP.01 24시간 안에 서울에서 부산까지 시내버스로 갈 수 있을까? (with 원지의 하루)", "author": "원지의 하루 × 버드모이", "originalUrl": "https://www.youtube.com/watch?v=rCZr6Uv_yW4", "hasAudio": true, shorts: curatedShorts("ko-vlog") },
    review: {"id": "ko-review", "headline": "review", "description": "Compare three editing styles", "source": showcaseAsset("ko-review-source", "video"), "poster": showcaseAsset("ko-review-source", "poster"), "title": "침착맨 음식 리뷰 모음집", "author": "침착맨 플러스", "originalUrl": "https://www.youtube.com/watch?v=Y-zhzOKvzVA", "hasAudio": true, shorts: curatedShorts("ko-review") },
    education: {"id": "ko-education", "headline": "슈카 설명을 짧게 들어봐요", "description": "궁금한 부분을 쇼츠로 골라봤어요", "source": showcaseAsset("ko-education-source", "video"), "poster": showcaseAsset("ko-education-source", "poster"), "title": "[FULL] 〈월간슈카〉 기름값이 우리 삶에 미치는 영향🛢️💰 경제 유튜버 슈카 보는 라디오ㅣ유민상의 배고픈 라디오ㅣ240702", "author": "슈카 · SBS Radio 에라오", "originalUrl": "https://www.youtube.com/watch?v=Pqmmn4HpnXg", "hasAudio": true, shorts: curatedShorts("ko-education") },
    entertainment: {"id": "ko-entertainment", "headline": "풍자랑 박나래가 만나면", "description": "같은 방송도 이렇게 다르게 편집돼요", "source": showcaseAsset("ko-entertainment-source", "video"), "poster": showcaseAsset("ko-entertainment-source", "poster"), "title": "언제까지 #나혼자산다? 관상 보러 온 언니들👀 풍자 & 박나래ㅣ관상학개론 EP.02", "author": "풍자 · 박나래 · TT STUDIO", "originalUrl": "https://www.youtube.com/watch?v=kPaGNeJagSM", "hasAudio": true, shorts: curatedShorts("ko-entertainment") },
    talk: {"id": "ko-talk", "headline": "곽튜브 토크로 만든 쇼츠예요", "description": "쇼츠를 눌러서 편집 스타일을 골라보세요", "source": showcaseAsset("ko-talk-source", "video"), "poster": showcaseAsset("ko-talk-source", "poster"), "title": "[FULL] 두뇌 서바이벌 게임의 새로운 서막!😈 ‘데블스 플랜’의 하석진, 서동주, 기욤, 곽튜브(곽준빈) 보는 라디오 | 두시탈출 컬투쇼 | 230926", "author": "곽튜브 · SBS Radio 에라오", "originalUrl": "https://www.youtube.com/watch?v=F-Dp78NJwlU", "hasAudio": true, shorts: curatedShorts("ko-talk") },
    gaming: { id: "ko-gaming", headline: "침착맨 영상으로 만든 쇼츠예요", description: "쇼츠를 눌러서 편집 스타일을 비교해 보세요", source: showcaseAsset("ko-gaming-source", "video"), poster: showcaseAsset("ko-gaming-source", "poster"), title: "따지지 말고 질문을 하세요 행님~", author: "침착맨 플러스", originalUrl: "https://www.youtube.com/watch?v=sLPF_ibWhOg", hasAudio: true, shorts: curatedShorts("ko-gaming") },
  },
  en: {
    review: {"id": "en-review", "headline": "Reviews & insights", "description": "The details you actually want to know", "source": showcaseAsset("en-review-source", "video"), "poster": showcaseAsset("en-review-source", "poster"), "title": "I BOUGHT THE FASTEST SUV IN THE WORLD! (TESLA MODEL X  P100D)", "author": "Tanner Fox", "originalUrl": "https://www.youtube.com/watch?v=id1D3Ud5-2Q", "hasAudio": true, shorts: curatedShorts("en-review") },
    entertainment: {"id": "en-entertainment", "headline": "One huge idea, three different Shorts", "description": "Pick an edit and see how the story changes", "source": showcaseAsset("en-entertainment-source", "video"), "poster": showcaseAsset("en-entertainment-source", "poster"), "title": "25 MILLION Orbeez Foam Pit VS Trampoline - Challenge", "author": "Tanner Fox", "originalUrl": "https://www.youtube.com/watch?v=bfigQ3DvIsY", "hasAudio": true, shorts: curatedShorts("en-entertainment") },
    education: {"id": "en-education", "headline": "John Green on the work you don’t see", "description": "One explanation, three ways to share it", "source": showcaseAsset("en-education-source", "video"), "poster": showcaseAsset("en-education-source", "poster"), "title": "Luck vs. Work vs. Skill vs. Privilege", "author": "John Green · vlogbrothers", "originalUrl": "https://www.youtube.com/watch?v=H4Cgx4EY8zs", "hasAudio": true, shorts: curatedShorts("en-education") },
    gaming: {"id": "en-gaming", "headline": "MMG’s NFL debut, three different edits", "description": "Tap a Short and pick your style", "source": showcaseAsset("en-gaming-source", "video"), "poster": showcaseAsset("en-gaming-source", "poster"), "title": "I Imported My Heisman TE To Madden 27!", "author": "MMG", "originalUrl": "https://www.youtube.com/watch?v=LOoynSCSLfI", "hasAudio": true, shorts: curatedShorts("en-gaming") },
    vlog: {"id": "en-vlog", "headline": "A Dubai vlog, three ways", "description": "Tap a Short to switch up the edit", "source": showcaseAsset("en-vlog-source", "video"), "poster": showcaseAsset("en-vlog-source", "poster"), "title": "MY DREAM CAME TRUE! *BRAND NEW 2017 FORD RAPTOR*", "author": "Tanner Fox", "originalUrl": "https://www.youtube.com/watch?v=iSH4sSFvrEg", "hasAudio": true, shorts: curatedShorts("en-vlog") },
    talk: {"id": "en-talk", "headline": "PewDiePie, in three different edits", "description": "Tap a Short and pick your style", "source": showcaseAsset("en-talk-source", "video"), "poster": showcaseAsset("en-talk-source", "poster"), "title": "PewDiePie on Why He Stopped Drinking", "author": "PewDiePie · Cold Ones Clips", "originalUrl": "https://www.youtube.com/watch?v=K3ecwyRMFSE", "hasAudio": true, shorts: curatedShorts("en-talk") },

  },
  ja: {
    gaming: {"id": "ja-gaming", "headline": "gaming", "description": "Compare three editing styles", "source": showcaseAsset("ja-gaming-source", "video"), "poster": showcaseAsset("ja-gaming-source", "poster"), "title": "【CRえぺまつり】ヒカキンさん(100万円)が自ら来てくれたのに、尋常じゃない殺気を感じて全力で逃走する一行【Apex/エーペックス】", "author": "ありさか × HIKAKIN", "originalUrl": "https://www.youtube.com/watch?v=AjD5LTBeLxU", "hasAudio": true, shorts: curatedShorts("ja-gaming") },
    review: {"id": "ja-review", "headline": "review", "description": "Compare three editing styles", "source": showcaseAsset("ja-review-source", "video"), "poster": showcaseAsset("ja-review-source", "poster"), "title": "うますぎると評判の「焼きそば弁当」を、ありえない量ドカ食いするスタンミじゃぱん", "author": "スタンミ", "originalUrl": "https://www.youtube.com/watch?v=qQ8zNDzgFV0", "hasAudio": true, shorts: curatedShorts("ja-review") },
    entertainment: {"id": "ja-entertainment", "headline": "はじめしゃちょー、このリアクション", "description": "同じ動画から、違うシーンと編集を見比べてみてください", "source": showcaseAsset("ja-entertainment-source", "video"), "poster": showcaseAsset("ja-entertainment-source", "poster"), "title": "番組MC土屋圭市がはじめしゃちょーと群サイ同乗走行フルバージョン！はじめしゃちょー失神寸前【番組コラボフルVer】", "author": "はじめしゃちょー × 土屋圭市", "originalUrl": "https://www.youtube.com/watch?v=g4eTYzq0Y_I", "hasAudio": true, shorts: curatedShorts("ja-entertainment") },
    vlog: {"id": "ja-vlog", "headline": "はじめしゃちょーが遊びに来た日", "description": "ショートをタップして、好きな雰囲気を選んでみてください", "source": showcaseAsset("ja-vlog-source", "video"), "poster": showcaseAsset("ja-vlog-source", "poster"), "title": "なんとはじめしゃちょーがしばなんハウスに来てくれたよ♡よかったねポンス！", "author": "はじめしゃちょー × しばなんといっしょ！", "originalUrl": "https://www.youtube.com/watch?v=zqSq1emHOUs", "hasAudio": true, shorts: curatedShorts("ja-vlog") },
    education: {"id": "ja-education", "headline": "リュウジのレシピを、ショートに", "description": "気になるショートをタップして見比べてみてください", "source": showcaseAsset("ja-education-source", "video"), "poster": showcaseAsset("ja-education-source", "poster"), "title": "市販のルーで作る【至高のカレー】", "author": "料理研究家リュウジのバズレシピ", "originalUrl": "https://www.youtube.com/watch?v=BcKNwo7bzJ4", "hasAudio": true, shorts: curatedShorts("ja-education") },
    talk: { id: "ja-talk", headline: "やまとのトークが、こんなショートに", description: "ショートをタップして、編集スタイルを見比べてみてください", source: showcaseAsset("ja-talk-source", "video"), poster: showcaseAsset("ja-talk-source", "poster"), title: "教育について語り合ったら楽し過ぎた！", author: "とある男が授業をしてみた × コムドット やまと", originalUrl: "https://www.youtube.com/watch?v=vznu6pLMPXA", hasAudio: true, shorts: curatedShorts("ja-talk") },

  },
};
export const defaultShowcaseCategory: Record<SiteLocale, ShowcaseCategory> = { ko: "talk", en: "talk", ja: "talk" };
