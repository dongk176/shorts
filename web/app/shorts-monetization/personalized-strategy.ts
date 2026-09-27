import { executionPlan } from "./execution-plan";
import { localizedHref } from "@/lib/i18n/routing";
import type { SiteLocale } from "@/lib/i18n/config";
import { textFor, type LocalText } from "@/lib/shorts-guides/catalog";
import { createPlan, type Answers, type Question } from "./monetization-model";
const L = (locale: SiteLocale) => (ko: string, en: string, ja: string) =>
  textFor([ko, en, ja], locale);
export function getStrategyQuestions(
  answers: Answers,
  locale: SiteLocale,
): Question[] {
  const l = L(locale),
    route = createPlan(answers, locale).route;
  const titles: Record<string, LocalText> = {
    affiliate: [
      "직접 소개할 제품이 있나요?",
      "Do you have a product you can honestly review?",
      "実際に紹介できる商品はありますか？",
    ],
    ads: [
      "같은 주제로 다음 편도 만들 수 있나요?",
      "Could you make more videos on the same topic?",
      "同じテーマで次の動画も作れそうですか？",
    ],
    sponsor: [
      "브랜드에 보여줄 대표 영상이 있나요?",
      "Do you have a sample you could show a brand?",
      "ブランドに見せられる代表動画はありますか？",
    ],
    sales: [
      "안내할 상품이나 서비스가 있나요?",
      "Do you have a product or service to offer?",
      "案内できる商品やサービスはありますか？",
    ],
    explore: [
      "직접 보여주거나 설명할 소재가 있나요?",
      "Is there something you can show or explain firsthand?",
      "自分で見せたり説明したりできるものはありますか？",
    ],
  };
  return [
    {
      key: "readiness",
      eyebrow: l(
        "내 전략 더 구체화하기",
        "Make it practical",
        "もう少し具体的に",
      ),
      title: textFor(titles[route], locale),
      description: l(
        "준비된 것에 맞춰 첫 과제를 바꿔드릴게요.",
        "Your first task will fit what you already have.",
        "今あるものに合わせて、最初の課題を考えます。",
      ),
      options: [
        {
          value: "ready",
          label: l(
            "네, 바로 활용할 수 있어요",
            "Yes, I have something ready",
            "はい、すぐに使えるものがあります",
          ),
          icon: "check",
        },
        {
          value: "notyet",
          label: l(
            "아직 준비가 필요해요",
            "Not yet, I need to prepare it",
            "まだ準備が必要です",
          ),
          icon: "seed",
        },
      ],
    },
    {
      key: "obstacle",
      eyebrow: l(
        "지금 가장 필요한 도움",
        "Where you need help",
        "今いちばん必要なこと",
      ),
      title: l(
        "가장 막히는 건 무엇인가요?",
        "What’s your biggest sticking point?",
        "いちばん困っているのはどこですか？",
      ),
      description: l(
        "지금 해결할 문제 하나에 집중해 볼게요.",
        "Let’s focus on one problem you can work on now.",
        "まずは一つの悩みに絞って考えましょう。",
      ),
      options: [
        {
          value: "ideas",
          label: l(
            "무슨 영상을 만들지 모르겠어요",
            "I’m stuck for video ideas",
            "何を作ればいいかわかりません",
          ),
          icon: "compass",
        },
        {
          value: "production",
          label: l(
            "촬영·편집이 오래 걸려요",
            "Filming and editing take too long",
            "撮影や編集に時間がかかります",
          ),
          icon: "clock",
        },
        {
          value: "retention",
          label: l(
            "올려도 시청자 반응이 적어요",
            "My videos aren’t getting much response",
            "投稿しても反応が少ないです",
          ),
          icon: "chart",
        },
        {
          value: "conversion",
          label: l(
            "반응은 있는데 수익으로 안 이어져요",
            "People watch, but it isn’t leading to income",
            "反応はあるのに収益につながりません",
          ),
          icon: "store",
        },
      ],
    },
  ];
}
export const personalizedStrategy = executionPlan;
export function personalizedPlanText(answers: Answers, locale: SiteLocale) {
  const p = personalizedStrategy(answers, locale),
    l = L(locale);
  const section = (title: string, lines: string[]) =>
    [title, ...lines].join("\n");
  return [
    l(
      "이지컷 · 나의 쇼츠 실행 계획",
      "EasyCut · My Shorts action plan",
      "EasyCut・自分のショート実行プラン",
    ),
    p.profile,
    p.positioning,
    section(
      l("오늘 할 일", "Today’s tasks", "今日やること"),
      p.today.map(
        (x) => `${x.minutes} min · ${x.title}\n${x.body}\n→ ${x.done}`,
      ),
    ),
    ...(p.sourceNote ? [p.sourceNote] : []),
    section(
      l("첫 영상 대본", "Video scripts", "動画の台本"),
      p.scripts.map(
        (x) =>
          `${x.number}. ${x.hook}\n${x.beats.map((b) => `${b.timing} · ${b.label}: ${b.text}`).join("\n")}\n${x.shot}`,
      ),
    ),
    section(
      l("이지컷 작업 순서", "EasyCut workflow", "EasyCutの手順"),
      p.workflow.map((x) => `${x.title}\n${x.body}`),
    ),
    section(
      l("수익화 연결", "Your earning path", "収益化への流れ"),
      p.revenueSteps,
    ),
    section(l("첫 주 일정", "First-week schedule", "最初の週の予定"), [
      p.timeTip,
      ...p.schedule.map(
        (x) => `${x.when} · ${x.title}\n${x.body}\n→ ${x.output}`,
      ),
    ]),
    section(
      l(
        "반응에 따른 다음 행동",
        "What to change next",
        "反応に合わせた次の行動",
      ),
      p.review.map((x) => `${x.signal}\n${x.action}`),
    ),
    p.focus.title,
    p.focus.action,
    p.focus.measure,
    p.skip,
    section(
      l("내 상황의 FAQ", "Your FAQs", "自分の状況のFAQ"),
      p.faqs.map((x) => `${x.q}\n${x.a}`),
    ),
    p.bookIntro,
    p.bookTitle,
    `https://www.easycut.co.kr${localizedHref("/shorts-monetization", locale)}#guide-library`,
  ].join("\n\n");
}
