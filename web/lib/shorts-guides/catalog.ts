import type { SiteLocale } from "@/lib/i18n/config";
export type LocalText = readonly [string, string, string];
export const textFor = (value: LocalText, locale: SiteLocale) =>
  value[{ ko: 0, en: 1, ja: 2 }[locale]];
export const guideSlugs = [
  "first-short",
  "affiliate",
  "series",
  "brand",
  "sales",
] as const;
export type StrategyGuideSlug = (typeof guideSlugs)[number];
export const libraryGuideSlugs = [
  ...guideSlugs,
  "after-work",
  "views-to-income",
  "weekend-shorts",
] as const;
export type GuideSlug = (typeof libraryGuideSlugs)[number];
export const guideCatalog: Record<
  GuideSlug,
  {
    title: LocalText;
    subtitle: LocalText;
    outcome: LocalText;
    chapters: LocalText[];
    color: string;
    pages?: number;
    language?: "ko";
  }
> = {
  "first-short": {
    title: [
      "이지컷으로 첫 쇼츠 완성하기",
      "Your first Short with EasyCut",
      "EasyCutで最初のショートを作ろう",
    ],
    subtitle: [
      "원본 준비부터 게시 후 개선까지",
      "From source footage to your next improvement",
      "素材の準備から、公開後の改善まで",
    ],
    outcome: [
      "첫 영상과 다음 편 기획서 완성",
      "Finish a video and outline the next one",
      "最初の動画と、次の企画を完成させる",
    ],
    color: "#b3a0ff",
    chapters: [
      ["한 사람, 한 질문", "One viewer, one question", "一人に、一つの答えを"],
      [
        "원본이 있는 경우와 없는 경우",
        "With or without footage",
        "映像がある人・これから撮る人",
      ],
      [
        "첫 문장과 세 장면",
        "An opening and three scenes",
        "最初の一言と三つの場面",
      ],
      [
        "편집 후 직접 확인할 것",
        "Check the edit yourself",
        "編集後に自分で確かめること",
      ],
      [
        "첫 반응을 다음 영상으로",
        "Turn feedback into your next video",
        "反応を次の動画につなげる",
      ],
    ],
  },
  affiliate: {
    title: [
      "써본 제품으로 시작하는 쇼츠 제휴 수익",
      "Affiliate Shorts from products you know",
      "使った商品のショートで始めるアフィリエイト",
    ],
    subtitle: [
      "손 촬영, 리뷰 대본, 구매 동선 실습",
      "Hands-only filming, honest reviews, and buyer journeys",
      "手元撮影・レビュー台本・購入までの導線",
    ],
    outcome: [
      "제품 하나의 리뷰 시리즈와 안내 동선 완성",
      "Build a review series and a clear next step",
      "一つの商品のシリーズと案内先を作る",
    ],
    color: "#f6b488",
    chapters: [
      [
        "제품보다 먼저 사용자를 고르기",
        "Choose the user before the product",
        "商品より先に、使う人を決める",
      ],
      [
        "솔직한 리뷰의 증거 촬영",
        "Film evidence for an honest review",
        "感想を裏付ける場面を撮る",
      ],
      [
        "한 제품, 서로 다른 세 질문",
        "One product, three distinct questions",
        "一つの商品、違う三つの質問",
      ],
      [
        "구매까지 직접 걸어보기",
        "Walk through the buying journey",
        "購入までの流れを自分でたどる",
      ],
      [
        "조회수와 주문을 나눠 보기",
        "Separate attention from orders",
        "再生と注文を分けて考える",
      ],
    ],
  },
  series: {
    title: [
      "다시 보러 오는 채널 만들기",
      "Build a channel people return to",
      "また見に来たくなるチャンネルづくり",
    ],
    subtitle: [
      "쇼츠 시리즈와 광고 수익 준비",
      "Shorts series and preparing for ad revenue",
      "ショートのシリーズと広告収益の準備",
    ],
    outcome: [
      "세 편의 시리즈와 개선 기록표 완성",
      "Outline three episodes and a review routine",
      "3本の企画と振り返りの習慣を作る",
    ],
    color: "#9bd8c5",
    chapters: [
      [
        "넓은 주제를 반복할 질문으로",
        "Turn a broad topic into repeatable questions",
        "広いテーマを、続けられる質問に",
      ],
      [
        "다음 편이 궁금한 시리즈",
        "A reason to watch the next episode",
        "次も見たくなるシリーズ",
      ],
      [
        "긴 원본에서 독립적인 이야기 찾기",
        "Find complete stories in long footage",
        "長い映像から、一つで伝わる話を探す",
      ],
      [
        "반응을 보고 한 가지씩 바꾸기",
        "Change one thing at a time",
        "反応を見て、一つずつ変える",
      ],
      [
        "광고 수익 신청 전 점검",
        "Before applying for ad revenue",
        "広告収益に申し込む前に",
      ],
    ],
  },
  brand: {
    title: [
      "작은 채널의 첫 브랜드 협업 준비",
      "Your first brand collaboration",
      "小さなチャンネルの初めての企業案件",
    ],
    subtitle: [
      "샘플 영상부터 제안서와 결과 보고까지",
      "From sample videos to pitches and reporting",
      "サンプル動画から提案・結果報告まで",
    ],
    outcome: [
      "샘플 영상과 보낼 수 있는 제안서 완성",
      "Create a sample and a pitch you can send",
      "サンプルと、送れる提案書を仕上げる",
    ],
    color: "#edafce",
    chapters: [
      [
        "브랜드에 설명할 내 시청자",
        "Describe your audience to a brand",
        "ブランドに伝わる視聴者の説明",
      ],
      [
        "협찬이 없어도 만들 수 있는 샘플",
        "Create a sample without a sponsor",
        "案件がなくても作れるサンプル",
      ],
      [
        "한 장으로 정리하는 채널 소개",
        "A one-page channel overview",
        "1枚で伝えるチャンネル紹介",
      ],
      [
        "첫 제안과 협업 범위 정리",
        "Your first pitch and scope",
        "最初の提案と協業の範囲",
      ],
      [
        "보고서와 다음 협업",
        "Report back and improve the next deal",
        "結果報告と次の協業",
      ],
    ],
  },
  sales: {
    title: [
      "쇼츠에서 내 상품·강의·상담으로",
      "From Shorts to your products and services",
      "ショートから商品・講座・相談へ",
    ],
    subtitle: [
      "고객 질문을 문의와 구매로 연결하기",
      "Connect customer questions to useful next steps",
      "お客さんの疑問を、次の一歩につなげる",
    ],
    outcome: [
      "질문형 영상과 상품 안내 페이지 초안 완성",
      "Draft a helpful video and its destination page",
      "疑問に答える動画と案内ページを作る",
    ],
    color: "#a2c5f8",
    chapters: [
      [
        "고객이 구매 전에 묻는 질문",
        "Questions customers ask before buying",
        "買う前に聞かれること",
      ],
      [
        "무료 설명과 유료 도움의 경계",
        "Useful advice and paid help",
        "無料で伝えること、有料で手伝うこと",
      ],
      [
        "강의·시연을 짧은 답변으로",
        "Turn a lesson into a short answer",
        "講座や実演を、短い答えに",
      ],
      [
        "영상과 안내 페이지 맞추기",
        "Match the video and the destination",
        "動画と案内先の内容を合わせる",
      ],
      [
        "문의의 질과 다음 상품 검증",
        "Learn from inquiries before building more",
        "問い合わせから次の商品を考える",
      ],
    ],
  },
  "after-work": {
    title: ["퇴근 후 쇼츠 한 편", "One Short After Work", "仕事帰りにショートを1本"],
    subtitle: ["시작부터 제작, 수익 연결까지", "From getting started to revenue opportunities", "始め方から制作、収益へのつなぎ方まで"],
    outcome: ["첫 10편과 30일 운영 계획 만들기", "Plan your first 10 videos and 30 days", "最初の10本と30日間の運営計画を作る"],
    color: "#86aaff", pages: 12, language: "ko",
    chapters: [
      ["주제 선정과 첫 10편 기획", "Choose a topic and plan 10 videos", "テーマ選びと最初の10本"],
      ["대본 예시와 화면 설계", "Script examples and shot planning", "台本例と画面構成"],
      ["주말 제작 루틴과 게시 점검", "Weekend production and publishing checks", "週末の制作手順と公開前チェック"],
      ["반응 개선과 수익 경로 선택", "Improve with feedback and choose a revenue path", "反応からの改善と収益の選択"],
      ["30일 실행표와 한 편 기획서", "30-day action plan and video worksheet", "30日間の実行表と動画企画シート"],
    ],
  },
  "views-to-income": {
    title: ["조회수 다음은 수익이다", "Beyond Views: Build Revenue", "再生数の次は、収益へ"],
    subtitle: ["제휴·협찬·자체 상품 실전 가이드", "A practical guide to affiliates, sponsors, and your own products", "アフィリエイト・協賛・自分の商品を実践"],
    outcome: ["내 채널의 수익 동선과 14일 실험 설계", "Design your revenue journey and a 14-day experiment", "収益への導線と14日間の検証を設計する"],
    color: "#e3ae63", pages: 12, language: "ko",
    chapters: [
      ["수익이 없는 이유와 경로 선택", "Find the gap and choose a revenue path", "収益につながらない理由と方法選び"],
      ["제휴 대본과 실제 구매 동선", "Affiliate scripts and buyer journeys", "アフィリエイト台本と購入導線"],
      ["협찬 제안문·견적·사용권", "Sponsor pitches, quotes, and usage rights", "協賛の提案・見積もり・使用権"],
      ["작은 상품 검증과 판매 페이지", "Validate a small product and its sales page", "小さな商品の検証と販売ページ"],
      ["이지컷 활용과 14일 실행표", "EasyCut workflow and 14-day action plan", "EasyCut活用と14日間の実行表"],
    ],
  },
  "weekend-shorts": {
    title: ["주말에 만드는 일주일 치 쇼츠", "A Week of Shorts, Made on the Weekend", "週末に作る、1週間分のショート"],
    subtitle: ["소재부터 AI 편집까지, 한 주 제작 루틴", "A weekly workflow from ideas to AI-assisted editing", "素材集めからAI編集までの週間制作ルーティン"],
    outcome: ["일주일 소재표와 반복 가능한 제작 흐름 완성", "Build a weekly idea plan and repeatable workflow", "1週間の素材表と続けられる制作手順を作る"],
    color: "#8cdaca", pages: 12, language: "ko",
    chapters: [
      ["소재 수집표와 일곱 가지 질문", "Idea collection and seven distinct questions", "素材収集表と七つの質問"],
      ["대본 틀과 촬영 준비", "Script templates and filming preparation", "台本テンプレートと撮影準備"],
      ["AI 요청문과 이지컷 후보 선별", "AI prompts and EasyCut clip selection", "AIへの依頼文とEasyCutの候補選び"],
      ["편집 검수와 일주일 게시 준비", "Editing checks and weekly publishing preparation", "編集チェックと1週間の公開準備"],
      ["주말 시간표와 제작 준비표", "Weekend schedule and production worksheet", "週末の時間割と制作準備シート"],
    ],
  },
};
export function recommendedGuide(route: string): StrategyGuideSlug {
  return (
    (
      {
        affiliate: "affiliate",
        ads: "series",
        sponsor: "brand",
        sales: "sales",
      } as Record<string, StrategyGuideSlug>
    )[route] || "first-short"
  );
}

export function guidePdfLocale(slug: GuideSlug, locale: SiteLocale): SiteLocale {
  return guideCatalog[slug].language ?? locale;
}
export function guideCoverSrc(slug: GuideSlug, locale: SiteLocale): string {
  const version = guideCatalog[slug].language ? "20261024" : "20260927-editorial-2";
  return `/shorts-guide-previews/${guidePdfLocale(slug, locale)}/${slug}-cover.jpg?v=${version}`;
}

// Keep new downloads compatible with the existing analytics DB allowlist.
export function analyticsGuide(slug: GuideSlug): StrategyGuideSlug | undefined {
  return guideSlugs.find((value) => value === slug);
}
