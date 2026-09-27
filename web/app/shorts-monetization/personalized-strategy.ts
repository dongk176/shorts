import type { SiteLocale } from "@/lib/i18n/config";
import {
  textFor,
  recommendedGuide,
  type LocalText,
} from "@/lib/shorts-guides/catalog";
import {
  answerLabel,
  createPlan,
  planText,
  type Answers,
  type Question,
} from "./monetization-model";
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
export function personalizedStrategy(answers: Answers, locale: SiteLocale) {
  const l = L(locale),
    plan = createPlan(answers, locale),
    limited = answers.time === "short" || answers.time === "medium",
    beginner = ["none", "starting"].includes(answers.stage || "none");
  const priorities: Record<string, LocalText> = {
    affiliate: [
      "상품을 더 사기 전에, 이미 써본 제품의 실제 사용 장면 하나부터 준비하세요. 누가 쓰면 좋은지와 불편한 점을 함께 보여주는 것이 첫 목표예요.",
      "Before buying more products, capture one real use of something you already know. Help a specific person decide by showing both a benefit and a drawback.",
      "新しく買う前に、使ったことのある商品の使用場面を一つ撮りましょう。向いている人と気になる点の両方を伝えるのが最初の目標です。",
    ],
    ads: [
      "수익 조건을 계산하기 전에, 같은 시청자가 궁금해할 질문 세 개를 연결하세요. 첫 편의 반응을 다음 편의 설명에 반영하는 작은 시리즈로 시작해요.",
      "Link three questions the same viewer would ask. Start a small series and use the first episode’s response to improve the next explanation.",
      "同じ視聴者が気になる質問を三つつなげましょう。最初の反応を次の説明に生かす、小さなシリーズから始めます。",
    ],
    sponsor: [
      "브랜드 이름부터 찾기보다, 누구를 위한 채널인지와 대표 영상을 한 장으로 정리하세요. 조회수만 나열하지 말고 실제 질문과 반응을 함께 담아요.",
      "Put your audience and representative work on one page before making a brand list. Include real questions and engagement, not just view counts.",
      "ブランドを探す前に、誰のためのチャンネルかと代表動画を1枚にまとめましょう。再生数だけでなく実際の質問や反応も添えます。",
    ],
    sales: [
      "상품 설명을 전부 넣지 말고, 구매 직전의 질문 하나에 먼저 답하세요. 더 자세한 도움을 받을 페이지는 영상의 약속과 같은 내용으로 연결해요.",
      "Answer one question someone asks just before buying. Point them to a page that delivers on the same promise as the video.",
      "商品のすべてを説明せず、買う前の疑問に一つ答えましょう。動画で伝えた内容と同じ約束をするページへ案内します。",
    ],
    explore: [
      "친구에게 자주 설명하는 것, 자주 쓰는 물건, 좋아하는 취미 중 하나를 고르세요. 수익 방식은 첫 영상의 제작 경험을 얻은 뒤 좁혀도 괜찮아요.",
      "Choose something you often explain, use, or enjoy. You can narrow down how to earn after learning what it takes to make your first video.",
      "よく説明すること、使うもの、好きな趣味から一つ選びましょう。収益化の方法は、最初の制作を経験してから絞っても大丈夫です。",
    ],
  };
  let priority = textFor(priorities[plan.route], locale);
  if (answers.readiness === "notyet")
    priority =
      plan.route === "sales"
        ? l(
            "아직 상품이 없으니 판매 페이지부터 만들지 마세요. 잘 설명할 수 있는 문제 하나를 영상으로 풀고, 실제로 들어온 질문을 모아 어떤 도움이 필요한지 확인해요.",
            "Without an offer yet, don’t build a sales page first. Explain one problem well and collect real questions to learn what help people need.",
            "商品がまだなければ、販売ページより先に得意な悩みを一つ解説しましょう。寄せられた質問から必要な助けを探ります。",
          )
        : plan.route === "sponsor"
          ? l(
              "협찬 제안 전에 같은 주제의 샘플 두 편부터 만들어 보세요. 실제 계약처럼 꾸미지 말고, 어떤 브랜드에 어떤 시청자를 소개할 수 있을지 보여주는 포트폴리오로 사용해요.",
              "Before pitching, create two samples on one topic. Clearly label them as samples, not real deals, and show which audience you could help a brand reach.",
              "提案の前に、同じテーマでサンプルを2本作りましょう。実案件のように見せず、どんな視聴者へ届けられるかを示す資料にします。",
            )
          : l(
              "이번에는 준비 비용을 늘리지 말고, 직접 보여줄 수 있는 소재 하나를 먼저 확보하세요. 자료만 모으기보다 짧게 촬영하거나 설명을 녹음해 실제 제작 시간을 확인해요.",
              "Keep preparation small: find one subject you can demonstrate firsthand. Film or record a short explanation to learn the real production time.",
              "準備を大きくせず、自分で見せられる素材を一つ確保しましょう。短く撮影や録音をして、実際の制作時間を確かめます。",
            );
  if (answers.source === "unknown")
    priority = l(
      "지금 가장 먼저 할 일은 원본의 편집·상업적 이용 권한 확인이에요. 확인 전에는 이 영상을 이지컷에 넣지 말고, 직접 만든 원본으로 아래 전략을 연습하세요.",
      "Your first step is confirming editing and commercial-use permission. Until then, don’t submit this footage to EasyCut; practise the strategy with your own material.",
      "最優先は編集と商用利用の許可の確認です。確認するまではその動画をEasyCutに入れず、自作の素材で下のプランを試しましょう。",
    );
  const focus: Record<
    string,
    { title: LocalText; action: LocalText; measure: LocalText }
  > = {
    ideas: {
      title: [
        "아이디어를 늘리기보다 질문을 좁혀요",
        "Narrow the question before adding ideas",
        "アイデアより、質問を絞ろう",
      ],
      action: [
        "아래 첫 영상 아이디어 중 하나를 고르고 ‘누가, 언제, 왜 이걸 궁금해할까?’를 한 문장으로 적으세요. 다른 두 아이디어는 다음 편으로 남겨요.",
        "Pick one idea below and write who would ask it, when, and why. Save the other two for later episodes.",
        "下の案から一つ選び、誰が・いつ・なぜ知りたいのかを一文で書きましょう。残りは次の動画に取っておきます。",
      ],
      measure: [
        "한 문장으로 주제를 설명할 수 있는지",
        "Can you explain the topic in one sentence?",
        "テーマを一文で説明できるか",
      ],
    },
    production: {
      title: [
        "오래 걸리는 한 단계부터 줄여요",
        "Reduce the slowest step first",
        "時間がかかる一工程から減らそう",
      ],
      action: [
        "소재 선택·촬영·이지컷 편집·검수에 걸린 시간을 따로 적으세요. 비슷한 장면은 한 번에 촬영하고, 첫 영상에서는 자막 스타일을 계속 바꾸지 않아요.",
        "Time topic selection, filming, EasyCut editing, and review separately. Batch similar scenes and keep one caption style for your first video.",
        "素材選び・撮影・EasyCut編集・確認の時間を別々に記録しましょう。似た場面はまとめて撮り、字幕スタイルは一つに絞ります。",
      ],
      measure: [
        "품질을 유지하면서 줄어든 제작 시간",
        "Production time saved without losing clarity",
        "わかりやすさを保ったまま短縮できた時間",
      ],
    },
    retention: {
      title: [
        "제목의 약속을 첫 장면에서 보여줘요",
        "Deliver the title’s promise in the opening",
        "タイトルの約束を最初の場面で見せよう",
      ],
      action: [
        "영상 시작을 소리 없이 봐도 주제가 보이는지 확인하세요. 다음 편에서는 주제를 유지하고 첫 장면이나 첫 문장 하나만 바꿔 비교해요.",
        "Check whether the opening makes sense without sound. In the next video, keep the topic and change only the first scene or sentence.",
        "音を消しても冒頭でテーマがわかるか確認しましょう。次はテーマを保ち、最初の場面か一言だけ変えて比べます。",
      ],
      measure: [
        "비슷한 길이·공개 기간의 영상에서 시청 지속과 질문 변화",
        "Watch duration and questions across videos with similar length and time since publication",
        "長さや公開後の期間が近い動画での視聴時間と質問の変化",
      ],
    },
    conversion: {
      title: [
        "수익 방식에 맞는 다음 행동을 점검해요",
        "Check the next step for your earning model",
        "収益化の方法に合う次の行動を確かめよう",
      ],
      action: [
        "제휴·판매라면 영상에서 안내 페이지까지 직접 이동해 보세요. 광고 수익형은 구매 버튼보다 재방문과 자격 요건, 협찬형은 제안 대상과 샘플의 적합성을 먼저 살펴요.",
        "For affiliate or sales content, try the path to the offer page. For ads, review returning viewers and eligibility; for sponsorships, check whether your samples fit the brands you approach.",
        "紹介や販売なら案内先まで自分で移動してみましょう。広告収益なら再訪問と条件、企業案件なら提案先とサンプルの相性を確認します。",
      ],
      measure: [
        "조회수와 클릭·문의·구매 또는 협업 회신을 분리해서 기록",
        "Track views separately from clicks, inquiries, purchases, or brand replies",
        "再生とクリック・問い合わせ・購入・提案への返事を別々に記録",
      ],
    },
  };
  const obstacle = focus[answers.obstacle || "ideas"] || focus.ideas;
  const workflow = [
    {
      title: l(
        "01 · 원본과 메시지 정하기",
        "01 · Choose footage and a message",
        "01・映像と伝えること",
      ),
      body: plan.ready
        ? l(
            "준비된 원본에서 질문과 답이 함께 이해되는 부분을 표시하세요. 편집할 수 있는 원본의 유튜브 링크를 준비하고, 전할 메시지를 한 줄로 적어요.",
            "Mark a complete question-and-answer section in your footage. Prepare an authorized YouTube source link and write the message in one line.",
            "映像から質問と答えが一緒にわかる部分を選びましょう。利用できるYouTube動画のリンクと、伝えたいことを一文で用意します。",
          )
        : l(
            "촬영이 먼저예요. 도입·실제 과정·결과를 담은 원본을 준비하세요. 이지컷에서 사용할 수 있는 입력 방식과 길이는 제작 화면의 안내를 확인해요.",
            "Film first: an introduction, the real process, and the result. Check EasyCut’s creation screen for supported inputs and source lengths.",
            "まずは導入・実際の過程・結果を撮りましょう。使える入力方法や映像の長さは、EasyCutの制作画面で確認できます。",
          ),
    },
    {
      title: l(
        "02 · 이지컷에서 초안 만들기",
        "02 · Make a draft in EasyCut",
        "02・EasyCutで下書きを作る",
      ),
      body: l(
        "원본을 입력하고 제작 화면의 설정을 확인해 하이라이트를 만들어요. 여러 후보 중 질문에 제대로 답하는 영상 하나를 고르고, 제목과 자막을 내 말투로 다듬으세요.",
        "Add your source, check the creation settings, and generate highlights. Choose one that fully answers the question, then edit the title and captions in your own voice.",
        "元動画を入力して設定を確認し、ハイライトを作ります。質問にきちんと答える候補を一つ選び、タイトルと字幕を自分の言葉に整えましょう。",
      ),
    },
    {
      title: l(
        "03 · 검수하고 직접 게시하기",
        "03 · Review and publish yourself",
        "03・確認して自分で公開する",
      ),
      body: l(
        "숫자·제품명·앞뒤 맥락을 원본과 대조하고, 휴대폰에서 글자와 피사체가 잘 보이는지 확인하세요. 완성본을 내려받아 게시한 뒤 아래 지표를 기록해요.",
        "Check numbers, names, and context against the source. Preview text and framing on a phone, download the finished video, publish it, and record the metrics below.",
        "数字・名称・前後の意味を元動画と照合し、スマホで文字と被写体を確認します。完成版を保存して公開し、下の項目を記録しましょう。",
      ),
    },
  ];
  const timeTip =
    answers.time === "weekend"
      ? l(
          "주말에는 같은 장소·조명을 쓰는 촬영을 모으세요. 편집과 검수 시간은 따로 남기고, 평일 공개는 직접 하거나 유튜브 예약 기능을 활용해요.",
          "Batch scenes that share a location and lighting at the weekend. Leave time for review, then publish during the week yourself or use YouTube scheduling.",
          "週末は場所と照明が同じ撮影をまとめましょう。編集と確認の時間も残し、平日の公開は手動かYouTubeの予約公開を使います。",
        )
      : limited
        ? l(
            "오늘은 한 영상의 첫 문장과 장면 선택까지만 끝내도 돼요. 내일 이지컷으로 편집하고, 검수는 다음 작업 시간에 분리하세요. 매일 한 편을 목표로 잡지 않아도 괜찮아요.",
            "Today, finish only the opening and scene selection. Edit in EasyCut next session and review separately. You don’t need a daily upload target.",
            "今日は冒頭と場面選びだけでも大丈夫。次にEasyCutで編集し、確認は別の時間に。毎日投稿を目標にしなくても構いません。",
          )
        : l(
            "추가로 확보한 시간은 제작량보다 비교에 써보세요. 같은 주제로 첫 문장이 다른 다음 영상을 만들고, 무엇을 바꿨는지 기록해요.",
            "Use extra time for deliberate comparisons, not just more output. Try a different opening on the same topic and record what changed.",
            "余裕のある時間は、本数より比較に使ってみましょう。同じテーマで冒頭を変え、何を変えたか記録します。",
          );
  const skip = beginner
    ? l(
        "새 장비 구매, 여러 플랫폼 동시 운영, 매일 업로드 약속은 첫 제작 시간을 확인한 뒤 결정하세요.",
        "Wait on new gear, multiple platforms, and daily upload commitments until you know your actual production time.",
        "新しい機材、複数SNSの同時運用、毎日投稿は、実際の制作時間がわかってから決めましょう。",
      )
    : l(
        "반응이 약한 영상을 모두 삭제하거나 주제·길이·제목을 한꺼번에 바꾸지 마세요. 무엇이 달라졌는지 비교하기 어려워져요.",
        "Avoid deleting every weak video or changing topic, length, and title together. You’ll lose the ability to tell what helped.",
        "反応の弱い動画を全部消したり、テーマ・長さ・タイトルを一度に変えたりせず、比較できる状態を残しましょう。",
      );
  const scripts = plan.ideas.map(([hook, detail], i) => ({
    hook,
    body: detail,
    shot:
      answers.format === "hands"
        ? l(
            "손 시연을 가까이 촬영 → 같은 조건의 전후 장면 → 결과를 자막으로 정리",
            "Close-up demo → before/after under the same conditions → caption the result",
            "手元の実演 → 同じ条件の前後 → 結果を字幕に",
          )
        : answers.format === "voice"
          ? l(
              "직접 녹화한 화면 → 핵심 부분 확대 → 내 목소리로 이유 설명",
              "Your screen recording → highlight the key detail → explain why in your voice",
              "自分の画面録画 → ポイントを拡大 → 自分の声で理由を説明",
            )
          : l(
              "문제가 보이는 장면 → 직접 보여주는 과정 → 결과와 한계",
              "Show the problem → demonstrate the process → share the result and limits",
              "困りごとの場面 → 自分で見せる過程 → 結果と限界",
            ),
    ending:
      plan.route === "affiliate"
        ? l(
            "어떤 사람에게 맞는지 설명하고, 확인한 구매 안내 위치를 알려주세요.",
            "Explain who it suits, then point to the buying information you checked.",
            "向いている人を伝え、確認した購入情報の場所を案内しましょう。",
          )
        : plan.route === "sales" && answers.readiness === "ready"
          ? l(
              "관련 상품·상담에서 어떤 도움을 더 받을 수 있는지 구체적으로 알려주세요.",
              "Explain exactly what extra help the related product or consultation provides.",
              "関連商品や相談で、どんな助けを追加で受けられるか伝えましょう。",
            )
          : l(
              "다음에 궁금한 질문 하나를 댓글로 남겨달라고 제안하세요.",
              "Invite viewers to leave one question they’d like you to answer next.",
              "次に知りたいことを一つ、コメントで聞いてみましょう。",
            ),
    number: i + 1,
  }));
  const faqs = [
    {
      q: plan.ready
        ? l(
            "AI가 고른 구간을 그대로 써도 될까요?",
            "Can I use the AI-selected clip as it is?",
            "AIが選んだ場面をそのまま使ってもいい？",
          )
        : l(
            "원본 없이 바로 시작할 수 있나요?",
            "Can I start without footage?",
            "映像がなくてもすぐ始められる？",
          ),
      a: workflow[plan.ready ? 2 : 0].body,
    },
    {
      q: l(
        "제 시간으로 매일 올려야 하나요?",
        "Do I need to post daily with my schedule?",
        "この時間でも毎日投稿した方がいい？",
      ),
      a: timeTip,
    },
    {
      q:
        answers.format === "face"
          ? l(
              "말을 잘해야만 하나요?",
              "Do I need to be a polished presenter?",
              "話すのが得意じゃないと難しい？",
            )
          : l(
              "얼굴 없이도 차별화할 수 있나요?",
              "How can I stand out without showing my face?",
              "顔を出さずに自分らしさを出せる？",
            ),
      a: l(
        "외모나 말솜씨보다 직접 경험한 근거를 보여주세요. 사용 조건, 실패한 과정, 선택한 이유처럼 자기 설명을 넣고 불필요한 반복을 편집하면 돼요.",
        "Show firsthand evidence: conditions, failed attempts, and why you chose a method. Add your own explanation and edit out repetition.",
        "見た目や話し方より、使った条件、失敗した過程、選んだ理由など自分の経験を見せましょう。繰り返しを編集で整えれば大丈夫です。",
      ),
    },
    {
      q: l(
        "반응이 적으면 무엇부터 바꾸죠?",
        "What should I change when response is weak?",
        "反応が少ないときは何から変える？",
      ),
      a: textFor(obstacle.action, locale),
    },
    {
      q: l(
        "이 전략을 따르면 수익이 나나요?",
        "Does this strategy guarantee income?",
        "この方法なら収益が出る？",
      ),
      a: plan.note,
    },
  ];
  return {
    priority,
    focus: {
      title: textFor(obstacle.title, locale),
      action: textFor(obstacle.action, locale),
      measure: textFor(obstacle.measure, locale),
    },
    workflow,
    timeTip,
    skip,
    scripts,
    faqs,
    guide: recommendedGuide(plan.route),
    profile: [
      answerLabel("category", answers.category, locale),
      plan.time.label,
      answerLabel("format", answers.format, locale),
    ].join(" · "),
  };
}
export function personalizedPlanText(answers: Answers, locale: SiteLocale) {
  const p = personalizedStrategy(answers, locale),
    l = L(locale);
  return [
    planText(answers, locale),
    "",
    l("지금의 우선순위", "Your priority", "今の優先順位"),
    p.priority,
    p.focus.title,
    p.focus.action,
    p.focus.measure,
    p.timeTip,
    p.skip,
    ...p.workflow.map((w) => `${w.title}\n${w.body}`),
    ...p.scripts.map(
      (s) => `${s.number}. ${s.hook}\n${s.body}\n${s.shot}\n${s.ending}`,
    ),
    ...p.faqs.map((f) => `${f.q}\n${f.a}`),
  ].join("\n\n");
}
