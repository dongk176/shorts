import { localizedHref } from "@/lib/i18n/routing";
import type { SiteLocale } from "@/lib/i18n/config";
import { monetizationTranslator } from "./monetization-copy";
export type QuestionKey =
  | "readiness"
  | "obstacle"
  | "category"
  | "goal"
  | "stage"
  | "source"
  | "format"
  | "time";
export type Answers = Partial<Record<QuestionKey, string>>;
export type Option = {
  value: string;
  label: string;
  detail?: string;
  icon?: string;
};
export type Question = {
  key: QuestionKey;
  eyebrow: string;
  title: string;
  description: string;
  options: Option[];
};

export function getQuestions(locale: SiteLocale = "ko"): Question[] {
  const t = monetizationTranslator(locale);
  return [
    {
      key: "category",
      eyebrow: t("콘텐츠 방향"),
      title: t("어떤 이야기를 쇼츠로 만들고 싶나요?"),
      description: t("가장 관심 있는 주제를 하나 선택하세요."),
      options: [
        { value: "products", label: t("제품 리뷰·생활용품"), icon: "bag" },
        { value: "knowledge", label: t("지식·노하우"), icon: "book" },
        { value: "food", label: t("요리·음식"), icon: "cup" },
        { value: "beauty", label: t("뷰티·패션"), icon: "spark" },
        { value: "gaming", label: t("게임"), icon: "game" },
        { value: "life", label: t("일상·여행·취미"), icon: "sun" },
        { value: "talk", label: t("인터뷰·강의"), icon: "mic" },
        { value: "unsure", label: t("아직 모르겠어요"), icon: "compass" },
      ],
    },
    {
      key: "goal",
      eyebrow: t("수익화 목표"),
      title: t("어떤 수익화 방법이 가장 궁금한가요?"),
      description: t("가장 먼저 시도하고 싶은 방법을 골라주세요."),
      options: [
        {
          value: "affiliate",
          label: t("쿠팡 파트너스 등 제휴 수익"),
          detail: t("소개한 상품의 구매가 발생하면 받는 수수료"),
          icon: "bag",
        },
        {
          value: "ads",
          label: t("유튜브 광고 수익"),
          detail: t("유튜브의 조건과 심사를 거쳐 배분받는 수익"),
          icon: "play",
        },
        {
          value: "sponsor",
          label: t("브랜드 협찬·광고"),
          detail: t("브랜드와 협의해 콘텐츠를 만들고 받는 대가"),
          icon: "spark",
        },
        {
          value: "sales",
          label: t("내 상품·서비스 판매"),
          detail: t("쇼츠를 보고 구매·상담으로 이어지는 수익"),
          icon: "store",
        },
        {
          value: "unsure",
          label: t("나에게 맞는 방법을 추천해 주세요"),
          icon: "compass",
        },
      ],
    },
    {
      key: "stage",
      eyebrow: t("채널의 현재"),
      title: t("지금 채널은 어느 단계인가요?"),
      description: t("구독자 수를 정확히 몰라도 괜찮아요."),
      options: [
        {
          value: "none",
          label: t("아직 채널이 없어요"),
          detail: t("무엇부터 시작할지 알아보고 있어요"),
          icon: "seed",
        },
        {
          value: "starting",
          label: t("이제 막 시작했어요"),
          detail: t("영상을 올리며 방향을 찾고 있어요"),
          icon: "play",
        },
        {
          value: "growing",
          label: t("꾸준히 올리고 반응도 있어요"),
          detail: t("내 콘텐츠를 보러 오는 시청자가 있어요"),
          icon: "chart",
        },
        {
          value: "earning",
          label: t("이미 수익을 내고 있어요"),
          detail: t("수익화 방법을 더 넓혀보고 싶어요"),
          icon: "spark",
        },
      ],
    },
    {
      key: "source",
      eyebrow: t("영상 준비"),
      title: t("쇼츠로 만들 영상은 준비되어 있나요?"),
      description: t("원본이 없어도 시작할 수 있는 방법을 안내해 드려요."),
      options: [
        {
          value: "own",
          label: t("직접 만든 영상이 있어요"),
          detail: t("내가 촬영한 영상·강의·인터뷰 등"),
          icon: "film",
        },
        { value: "film", label: t("새로 촬영할 수 있어요"), icon: "camera" },
        {
          value: "licensed",
          label: t("사용 권한을 확인한 영상이 있어요"),
          detail: t("편집과 상업적 이용이 허용된 영상"),
          icon: "check",
        },
        {
          value: "unknown",
          label: t("다른 사람 영상인데 권한은 잘 몰라요"),
          icon: "book",
        },
        { value: "none", label: t("아직 준비된 영상이 없어요"), icon: "seed" },
      ],
    },
    {
      key: "format",
      eyebrow: t("제작 스타일"),
      title: t("어떤 방식으로 보여줄 수 있나요?"),
      description: t("얼굴을 공개하지 않는 방식도 충분히 있어요."),
      options: [
        {
          value: "face",
          label: t("얼굴과 목소리 출연이 가능해요"),
          icon: "smile",
        },
        {
          value: "hands",
          label: t("얼굴 없이 손·제품·장면을 찍고 싶어요"),
          icon: "camera",
        },
        {
          value: "voice",
          label: t("목소리·화면 녹화로 설명하고 싶어요"),
          icon: "mic",
        },
        { value: "unsure", label: t("아직 정하지 못했어요"), icon: "compass" },
      ],
    },
    {
      key: "time",
      eyebrow: t("하루 가용 시간"),
      title: t("하루에 얼마나 시간을 쓸 수 있나요?"),
      description: t("촬영, 편집, 채널 운영에 쓸 수 있는 시간을 골라주세요."),
      options: [
        {
          value: "short",
          label: t("30분 미만"),
          detail: t("짧게 나누어 작업"),
          icon: "clock",
        },
        {
          value: "medium",
          label: t("30분~1시간 미만"),
          detail: t("하루 한 단계씩"),
          icon: "clock",
        },
        {
          value: "long",
          label: t("1~2시간 미만"),
          detail: t("촬영과 편집에 집중"),
          icon: "clock",
        },
        {
          value: "full",
          label: t("2시간 이상"),
          detail: t("제작과 분석 병행"),
          icon: "clock",
        },
        {
          value: "weekend",
          label: t("주말에 몰아서 할 수 있어요"),
          icon: "calendar",
        },
        { value: "unsure", label: t("아직 모르겠어요"), icon: "compass" },
      ],
    },
  ];
}
export const questions = getQuestions();

export type Route = "affiliate" | "ads" | "sponsor" | "sales" | "explore";
function getRoutes(locale: SiteLocale): Record<
  Route,
  {
    label: string;
    title: string;
    description: string;
    first: string;
    metrics: string[];
  }
> {
  const t = monetizationTranslator(locale);
  return {
    affiliate: {
      label: t("제휴 수익형"),
      title: t("제품 리뷰로 시작하는 제휴 수익화"),
      description: t(
        "제품의 장점과 아쉬운 점을 직접 보여주세요. 시청자가 자신에게 맞는 제품인지 판단하도록 돕는 콘텐츠로 시작해 보세요.",
      ),
      first: t(
        "실제로 사용해 본 제품 하나와 그 제품이 필요한 사람을 정해보세요.",
      ),
      metrics: [
        t("시청 지속 시간"),
        t("제품 관련 질문"),
        t("제휴 보고서의 클릭·주문"),
      ],
    },
    ads: {
      label: t("시청자 성장형"),
      title: t("시리즈 콘텐츠로 준비하는 광고 수익"),
      description: t(
        "한 주제를 꾸준히 다루며 다시 찾아올 이유를 만들어주세요. 시청자 반응을 쌓으며 유튜브 광고 수익의 신청 조건을 준비하는 방향이에요.",
      ),
      first: t(
        "한 명의 시청자가 궁금해할 질문 3개를 적고 첫 편의 주제를 고르세요.",
      ),
      metrics: [
        t("시청 지속 시간"),
        t("다시 보는 시청자"),
        t("영상별 구독 전환"),
      ],
    },
    sponsor: {
      label: t("브랜드 협업형"),
      title: t("채널 주제에 맞는 브랜드 협업"),
      description: t(
        "어떤 시청자에게 어떤 이야기를 전하는지 보여주세요. 실제 콘텐츠와 반응을 모아 채널에 어울리는 브랜드와의 협업을 준비할 수 있어요.",
      ),
      first: t(
        "채널 주제, 시청자 특징, 대표 콘텐츠를 한 장으로 정리해 보세요.",
      ),
      metrics: [
        t("시청자 반응"),
        t("대표 콘텐츠의 성과"),
        t("제안에 대한 회신"),
      ],
    },
    sales: {
      label: t("상품·서비스 연결형"),
      title: t("상품·서비스로 연결하는 정보 콘텐츠"),
      description: t(
        "고객이 자주 하는 질문에 짧고 명확하게 답해주세요. 더 자세한 도움이 필요한 시청자에게 내 상품이나 상담을 자연스럽게 소개하는 방향이에요.",
      ),
      first: t(
        "판매할 상품·서비스가 있다면 고객 질문 하나를 고르세요. 아직 없다면 잘 설명할 수 있는 주제부터 검증해 보세요.",
      ),
      metrics: [
        t("관련 질문·댓글"),
        t("상품·상담 페이지 방문"),
        t("실제 문의·구매"),
      ],
    },
    explore: {
      label: t("첫 콘텐츠 탐색형"),
      title: t("첫 콘텐츠 주제부터 정하기"),
      description: t(
        "지금 수익화 방법을 확정할 필요는 없어요. 직접 보여줄 수 있는 소재와 즐겁게 반복할 수 있는 주제를 먼저 찾아보세요.",
      ),
      first: t(
        "자주 쓰는 물건, 잘 설명하는 일, 좋아하는 취미를 하나씩 적어보세요.",
      ),
      metrics: [
        t("실제 제작 소요 시간"),
        t("계속 만들고 싶은 주제"),
        t("시청자의 질문"),
      ],
    },
  };
}
function getIdeas(locale: SiteLocale): Record<string, [string, string][]> {
  const t = monetizationTranslator(locale);
  return {
    products: [
      [
        t("구매 전에 이 크기부터 확인하세요"),
        t("직접 잰 크기와 실제 사용 장면을 함께 보여주세요."),
      ],
      [
        t("써보고 알게 된 장점 하나, 아쉬운 점 하나"),
        t("경험한 내용만 골라 같은 조건에서 비교해 보세요."),
      ],
      [
        t("이 제품이 맞는 사람과 안 맞는 사람"),
        t("사용 목적에 따라 달라지는 선택 기준을 설명해 주세요."),
      ],
    ],
    knowledge: [
      [
        t("처음 시작할 때 가장 많이 하는 실수"),
        t("실수 한 가지와 바로 적용할 해결법을 짝지어 주세요."),
      ],
      [
        t("이 질문에는 이렇게 답해요"),
        t("직접 설명할 수 있는 질문 하나를 짧게 풀어주세요."),
      ],
      [
        t("방법을 바꾸기 전과 후"),
        t("직접 해본 과정을 보여주고 달라진 점을 설명해 주세요."),
      ],
    ],
    food: [
      [
        t("이 요리에서 가장 중요한 한 단계"),
        t("직접 조리하며 놓치기 쉬운 지점을 가까이 찍어주세요."),
      ],
      [
        t("남은 재료 하나로 만드는 한 끼"),
        t("준비물과 완성 모습을 먼저 보여주세요."),
      ],
      [
        t("같은 재료, 다른 조리 방법"),
        t("실제로 만들어 본 두 방식의 차이를 설명해 주세요."),
      ],
    ],
    beauty: [
      [
        t("직접 써보고 발견한 사용 팁"),
        t("나의 사용 조건과 사용감을 함께 설명해 주세요."),
      ],
      [
        t("한 가지 아이템, 두 가지 스타일"),
        t("직접 연출한 모습을 같은 구도로 보여주세요."),
      ],
      [
        t("구매 전에 확인할 세 가지"),
        t("색상·크기·사용 목적처럼 확인 가능한 기준을 골라주세요."),
      ],
    ],
    gaming: [
      [
        t("이 장면이 어려웠던 이유"),
        t("직접 플레이한 영상에서 목표와 결과를 함께 보여주세요."),
      ],
      [
        t("처음 하는 사람에게 알려줄 한 가지"),
        t("자기 플레이로 작은 팁을 시연해 주세요."),
      ],
      [
        t("실패한 방법과 바꾼 방법"),
        t("자기 녹화에서 차이를 보여주는 두 장면을 골라주세요."),
      ],
    ],
    life: [
      [
        t("내가 이 취미를 계속하는 이유"),
        t("직접 경험한 작은 순간으로 이야기를 시작해 주세요."),
      ],
      [
        t("처음 가는 사람에게 알려줄 팁"),
        t("직접 방문하거나 경험한 내용을 장면과 함께 보여주세요."),
      ],
      [
        t("평범한 일상을 조금 편하게 하는 방법"),
        t("자신의 일상에서 반복하는 루틴 한 가지를 보여주세요."),
      ],
    ],
    talk: [
      [
        t("한 질문에 담긴 가장 명확한 답변"),
        t("자기 영상에서 질문과 답이 함께 이해되는 구간을 골라주세요."),
      ],
      [
        t("긴 설명을 한 가지 예시로"),
        t("강의의 핵심을 설명하는 실제 예시를 중심에 놓아주세요."),
      ],
      [
        t("대화에서 가장 생각하게 된 순간"),
        t("앞뒤 맥락을 유지하며 핵심 발언을 소개해 주세요."),
      ],
    ],
    unsure: [
      [
        t("친구가 나에게 자주 물어보는 것"),
        t("내가 쉽게 설명할 수 있는 질문 하나에 답해 보세요."),
      ],
      [
        t("내가 가장 자주 쓰는 물건"),
        t("직접 쓰는 이유를 실제 사용 장면으로 보여주세요."),
      ],
      [
        t("이번 주 직접 해본 작은 도전"),
        t("시작·과정·느낀 점을 자기 장면으로 기록해 보세요."),
      ],
    ],
  };
}
function getTimePlans(
  locale: SiteLocale,
): Record<
  string,
  { label: string; pace: string; steps: [string, string, string][] }
> {
  const t = monetizationTranslator(locale);
  return {
    short: {
      label: t("하루 30분 미만"),
      pace: t("한 번에 한 가지씩, 여러 날에 나눠도 괜찮아요."),
      steps: [
        [
          t("1일"),
          t("소재 하나 정하기"),
          t("시청자 한 명과 전할 내용 하나만 적어요."),
        ],
        [
          t("2~3일"),
          t("원본 준비하기"),
          t("필요한 장면을 촬영하거나 내 영상에서 골라요."),
        ],
        [
          t("4~5일"),
          t("첫 영상 다듬기"),
          t("하루는 구성, 다음 날은 자막을 확인해요."),
        ],
        [
          t("6~7일"),
          t("공개하고 돌아보기"),
          t("가능한 날 공개하고, 다음에 바꿀 점 하나를 기록해요."),
        ],
      ],
    },
    medium: {
      label: t("하루 30분~1시간 미만"),
      pace: t("하루 한 단계에 집중하는 첫 주를 만들어 보세요."),
      steps: [
        [
          t("1일"),
          t("주제와 구성 정하기"),
          t("첫 문장과 보여줄 장면을 적어요."),
        ],
        [
          t("2~3일"),
          t("촬영하고 편집하기"),
          t("내 원본을 준비하고 핵심 내용만 남겨요."),
        ],
        [
          t("4~5일"),
          t("확인하고 공개하기"),
          t("자막·맥락·안내 동선을 확인한 뒤 공개해요."),
        ],
        [
          t("6~7일"),
          t("다음 편 준비하기"),
          t("시청자 반응을 참고해 다음 질문을 골라요."),
        ],
      ],
    },
    long: {
      label: t("하루 1~2시간 미만"),
      pace: t("만드는 시간과 반응을 살피는 시간을 함께 확보해요."),
      steps: [
        [
          t("1일"),
          t("작은 시리즈 기획하기"),
          t("같은 주제로 이어질 질문을 세 개 정해요."),
        ],
        [
          t("2~3일"),
          t("촬영·편집 묶어 하기"),
          t("비슷한 장면은 함께 촬영하고 첫 편을 다듬어요."),
        ],
        [
          t("4~5일"),
          t("공개 후 반응 보기"),
          t("어디서 흥미를 느끼는지 댓글과 지표를 살펴요."),
        ],
        [
          t("6~7일"),
          t("다음 구성 실험하기"),
          t("첫 문장이나 설명 방식 중 한 가지를 바꿔봐요."),
        ],
      ],
    },
    full: {
      label: t("하루 2시간 이상"),
      pace: t("제작량을 늘리기 전에, 반복 가능한 과정을 만들어봐요."),
      steps: [
        [
          t("1일"),
          t("시청자와 시리즈 정하기"),
          t("한 주제의 소재를 모으고 순서를 정해요."),
        ],
        [
          t("2~3일"),
          t("여러 소재 묶어 촬영하기"),
          t("원본을 정리하고 각 영상의 맥락을 살려 편집해요."),
        ],
        [
          t("4~5일"),
          t("순서대로 공개하기"),
          t("검수 시간을 따로 두고 영상별 반응을 기록해요."),
        ],
        [
          t("6~7일"),
          t("다음 실험 설계하기"),
          t("반응과 제작 시간을 비교하고 바꿀 요소 하나를 정해요."),
        ],
      ],
    },
    weekend: {
      label: t("주말 집중형"),
      pace: t("주말에 준비하고, 가능한 날에 나눠 공개하세요."),
      steps: [
        [
          t("준비"),
          t("소재 메모 모으기"),
          t("여유가 생길 때 질문과 촬영할 장면을 적어요."),
        ],
        [
          t("토요일"),
          t("원본 준비하기"),
          t("내 영상을 고르거나 필요한 장면을 모아서 촬영해요."),
        ],
        [
          t("일요일"),
          t("편집·검수하기"),
          t("자막과 맥락을 확인하고 공개할 영상을 준비해요."),
        ],
        [
          t("다음 주"),
          t("공개와 반응 확인"),
          t("가능한 날 직접 공개하거나 유튜브 예약 기능을 이용해요."),
        ],
      ],
    },
    unsure: {
      label: t("내 페이스 찾기"),
      pace: t("먼저 작은 작업 하나의 소요 시간을 재보세요."),
      steps: [
        [
          t("첫 작업"),
          t("주제 하나 정하기"),
          t("잘 아는 소재를 고르는 데 걸린 시간을 기록해요."),
        ],
        [
          t("다음 작업"),
          t("짧은 원본 준비하기"),
          t("촬영이나 장면 선택을 한 번 해보세요."),
        ],
        [
          t("편집"),
          t("첫 영상 다듬기"),
          t("어떤 과정에 시간이 많이 드는지 확인해요."),
        ],
        [
          t("돌아보기"),
          t("계속할 수 있는 일정 정하기"),
          t("실제 소요 시간을 기준으로 다음 주 계획을 잡아요."),
        ],
      ],
    },
  };
}

export function answerLabel(
  key: QuestionKey,
  value?: string,
  locale: SiteLocale = "ko",
) {
  const t = monetizationTranslator(locale);
  const questions = getQuestions(locale);
  return (
    questions.find((q) => q.key === key)?.options.find((o) => o.value === value)
      ?.label || t("아직 모르겠어요")
  );
}

export function isComplete(answers: Answers) {
  return questions.every((q) =>
    q.options.some((o) => o.value === answers[q.key]),
  );
}

export function createPlan(answers: Answers, locale: SiteLocale = "ko") {
  const t = monetizationTranslator(locale);
  const routes = getRoutes(locale);
  const ideas = getIdeas(locale);
  const timePlans = getTimePlans(locale);
  let route: Route = "explore";
  if (["affiliate", "ads", "sponsor", "sales"].includes(answers.goal || ""))
    route = answers.goal as Route;
  else if (["products", "beauty", "food"].includes(answers.category || ""))
    route = "affiliate";
  else if (answers.stage === "growing" || answers.stage === "earning")
    route = "sponsor";
  else if (answers.category && answers.category !== "unsure") route = "ads";
  const content = routes[route];
  const ready = answers.source === "own" || answers.source === "licensed";
  const beginnerSponsor =
    route === "sponsor" &&
    (answers.stage === "none" || answers.stage === "starting");
  const preparation =
    answers.source === "unknown"
      ? t(
          "먼저 원본의 편집·상업적 이용 범위를 확인해 주세요. 확인하기 어렵다면 직접 촬영하거나 녹화한 소재로 시작하세요.",
        )
      : ready
        ? t(
            "준비된 원본에서 한 가지 메시지가 온전히 전달되는 구간을 골라보세요.",
          )
        : t(
            "촬영할 장면 3개와 첫 문장 하나를 적어보세요. 원본이 준비되면 편집을 시작할 수 있어요.",
          );
  const format =
    answers.format === "hands"
      ? t(
          "얼굴 없이 손·제품·현장 장면으로 보여주고, 자막으로 맥락을 더해보세요.",
        )
      : answers.format === "voice"
        ? t(
            "직접 녹화한 화면이나 사용 가능한 장면에 내 목소리 설명을 더해보세요.",
          )
        : answers.format === "face"
          ? t("직접 말하는 짧은 도입과 실제 장면을 함께 담아보세요.")
          : t(
              "출연이 편하지 않다면 손 시연이나 자기 화면 녹화부터 시도해 보세요.",
            );
  return {
    route,
    ...content,
    label: beginnerSponsor ? t("브랜드 협업 준비형") : content.label,
    first: beginnerSponsor
      ? t(
          "같은 주제의 샘플 콘텐츠를 먼저 만들고, 어떤 시청자에게 도움이 되는지 정리해 보세요.",
        )
      : content.first,
    preparation,
    format,
    ready,
    reason:
      answers.goal !== "unsure" && answers.goal
        ? t(
            "선택한 관심 분야는 ‘{goal}’입니다. 현재 준비 상태에 맞게 시작 단계를 잡았어요.",
            { goal: answerLabel("goal", answers.goal, locale) },
          )
        : route === "explore"
          ? t(
              "아직 방향이 정해지지 않았으니, 직접 만들 수 있는 소재를 작게 실험하는 것부터 추천해요.",
            )
          : t(
              "‘{category}’ 콘텐츠와 현재 채널 단계를 함께 고려한 시작 방향이에요.",
              { category: answerLabel("category", answers.category, locale) },
            ),
    ideas: ideas[answers.category || "unsure"] || ideas.unsure,
    time: timePlans[answers.time || "unsure"] || timePlans.unsure,
    note:
      route === "affiliate"
        ? t(
            "쇼츠 설명·댓글의 URL은 클릭되지 않아요. 채널 프로필 등 실제 이동 경로와 제휴 서비스의 공개 표시·이용 조건을 확인하세요.",
          )
        : route === "ads"
          ? t(
              "광고 수익은 유튜브 파트너 프로그램의 자격 요건과 심사를 거쳐요. 이 결과가 수익화 자격이나 승인을 판정하지는 않아요.",
            )
          : route === "sponsor"
            ? t(
                "제품 제공과 현금 지급은 다른 협업 조건이에요. 대가, 제작 범위, 콘텐츠 활용 범위를 미리 확인하세요.",
              )
            : route === "sales"
              ? t(
                  "판매할 상품이 아직 없다면 먼저 시청자의 질문을 모아보세요. 관심과 실제 구매 의향은 구분해서 살펴야 해요.",
                )
              : t(
                  "첫 주의 목표는 수익 금액보다 계속 만들 수 있는 주제와 제작 방식을 찾는 거예요.",
                ),
  };
}

export function planText(answers: Answers, locale: SiteLocale = "ko") {
  const t = monetizationTranslator(locale);
  const plan = createPlan(answers, locale);
  return [
    t("이지컷 · 나의 쇼츠 시작 계획"),
    plan.label,
    plan.title,
    plan.reason,
    "",
    t("먼저 할 일"),
    plan.first,
    plan.preparation,
    plan.format,
    "",
    t("첫 영상 아이디어"),
    ...plan.ideas.map(([title, detail], i) => `${i + 1}. ${title}\n${detail}`),
    "",
    plan.time.label,
    plan.time.pace,
    ...plan.time.steps.map(
      ([day, title, detail]) => `${day} · ${title}\n${detail}`,
    ),
    "",
    t("확인할 지표"),
    plan.metrics.join(" · "),
    plan.note,
    "",
    t("실행 방향을 위한 제안이며 수입·제작량·승인을 보장하지 않습니다."),
    `https://www.easycut.co.kr${localizedHref("/shorts-monetization", locale)}`,
  ].join("\n");
}
