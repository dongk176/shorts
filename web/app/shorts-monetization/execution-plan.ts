import type { SiteLocale } from "@/lib/i18n/config";
import {
  textFor,
  recommendedGuide,
  guideCatalog,
  type LocalText,
} from "@/lib/shorts-guides/catalog";
import { answerLabel, createPlan, type Answers } from "./monetization-model";
import { topics, revenue } from "./execution-content";

export function executionPlan(answers: Answers, locale: SiteLocale) {
  const l = (ko: string, en: string, ja: string) =>
    textFor([ko, en, ja], locale);
  const tr = (s: LocalText) => textFor(s, locale);
  const plan = createPlan(answers, locale);
  const topic = topics[answers.category || "unsure"] || topics.unsure;
  const route = revenue[plan.route];
  const missing = answers.readiness === "notyet";
  const beginner = ["none", "starting"].includes(answers.stage || "none");
  const ownSourceNeeded = ["unknown", "none", "film"].includes(
    answers.source || "none",
  );
  const noOffer = plan.route === "sales" && missing;
  const sampleNeeded = plan.route === "sponsor" && (missing || beginner);
  const testMode = answers.time === "unsure" || !answers.time;
  const timeKey = ["short", "medium", "long", "full", "weekend"].includes(
    answers.time || "",
  )
    ? answers.time!
    : "short";
  const budgets: Record<string, [number, number, number]> = {
    short: [5, 10, 5],
    medium: [10, 20, 10],
    long: [15, 45, 30],
    full: [20, 60, 40],
    weekend: [15, 45, 30],
  };
  const minutes = budgets[timeKey];
  const audience = tr(topic.audience),
    subject = tr(topic.subject);
  const firstHook = tr(topic.hooks[0]);
  const affiliateBridge: Record<string, LocalText> = {
    knowledge: [
      "지식 콘텐츠의 제휴 연결은 설명에 실제로 쓴 도구나 제품으로 한정해요. 먼저 사용법의 문제를 해결하고, 그 도구가 필요한 사람에게만 구매 정보를 안내하세요.",
      "For educational affiliate content, connect only tools or products you actually used in the demonstration. Solve the task first, then offer buying information to viewers who need that tool.",
      "知識系の紹介は実演で本当に使った道具や商品に絞ります。先に課題を解決し、その道具が必要な人に購入情報を案内しましょう。",
    ],
    gaming: [
      "게임 제휴형이라면 직접 쓰는 주변기기나 장비의 사용감을 플레이 장면과 연결해요. 장비가 실력을 보장한다고 말하지 말고 조작감·설치·호환성처럼 확인한 차이를 보여주세요.",
      "For gaming affiliate content, connect gear you use to your gameplay. Show verified differences in controls, setup, or compatibility without implying gear guarantees skill.",
      "ゲームの紹介なら実際の周辺機器をプレイに結びつけ、上達の保証ではなく操作感・設置・互換性の違いを見せます。",
    ],
    talk: [
      "인터뷰·강의 제휴형이라면 대화 속에서 실제로 사용한 도구나 책이 필요한 맥락을 설명해요. 화자의 추천이 없는 상품을 추천한 것처럼 편집하지 않아요.",
      "For talks, explain the context for a tool or book actually used. Do not edit a speaker into appearing to endorse a product they did not recommend.",
      "対話や講義では実際に使った道具や本が必要な理由を説明。話し手が勧めていない商品を推薦したように編集しません。",
    ],
    life: [
      "일상·여행 제휴형은 직접 쓰는 준비물이나 취미 도구를 실제 상황에서 보여주는 방식이 잘 맞아요. 장소 소개와 구매 안내를 섞기보다 그 물건이 필요했던 순간을 한 편으로 만드세요.",
      "For lifestyle affiliate videos, demonstrate your own travel or hobby items in use. Focus one episode on the moment the item was needed instead of mixing a destination guide with a sales pitch.",
      "日常・旅行の紹介なら、自分の持ち物や趣味の道具を使う場面で。その物が必要だった瞬間を1本にします。",
    ],
  };
  const bridge =
    plan.route === "affiliate" && affiliateBridge[answers.category || ""]
      ? tr(affiliateBridge[answers.category!])
      : "";

  const stageActions: Record<string, LocalText> = {
    none: [
      "채널을 만들 때 이름보다 먼저 ‘누구에게 무엇을 알려주는가’를 소개 한 줄로 적어요. 첫 공개 전 프로필·소개·문의 또는 안내 위치를 확인하세요.",
      "Before choosing a channel name, write whom you help and how. Check your profile, description, and contact or information location before publishing.",
      "名前より先に、誰に何を伝えるかを一文に。初投稿前にプロフィール・紹介・連絡先を確認しましょう。",
    ],
    starting: [
      "최근 영상이 있다면 주제·첫 문장·길이·제작 시간을 한 줄씩 적어요. 이번에는 같은 시청자에게 맞는 주제를 유지하고 첫 장면 하나만 바꿔볼 거예요.",
      "List each recent video’s topic, opening, length, and production time. Keep the same audience and change one opening scene in this experiment.",
      "最近の動画のテーマ・冒頭・長さ・制作時間を記録。同じ視聴者に向け、最初の場面を一つ変えてみます。",
    ],
    growing: [
      "최근 영상 중 비슷한 공개 기간으로 비교할 수 있는 3편을 골라요. 반응이 좋았던 질문과 댓글의 후속 질문을 연결해 다음 시리즈를 기획하세요.",
      "Choose three recent videos with comparable time since publication. Connect the strongest question with follow-ups in comments to outline a series.",
      "公開後の期間が近い3本を選び、反応のよい質問とコメントの続きをつないで次のシリーズを考えます。",
    ],
    earning: [
      "기존 수익 경로는 유지하고 이번 전략은 작은 실험으로 분리해요. 투입 시간·실제 확정 수익·문의 유형을 함께 기록해 추가할 가치가 있는지 판단하세요.",
      "Keep your existing income path and treat this as a separate small experiment. Track time, confirmed revenue, and inquiry types to decide whether to expand it.",
      "今の収益経路を保ち、小さな別実験として進めます。時間・確定収益・相談内容を記録し、広げる価値を判断しましょう。",
    ],
  };
  const stageAction = tr(
    stageActions[answers.stage || "none"] || stageActions.none,
  );
  const sourceActions: Record<string, LocalText> = {
    own: [
      "내 원본을 처음부터 빠르게 훑고 질문·답·증거가 이어지는 시작/끝 시간을 3곳 표시해요. 가장 명확한 한 구간을 첫 편으로 쓰고 나머지는 다음 질문의 후보로 남겨요.",
      "Scan your footage and mark three start/end ranges containing a question, answer, and evidence. Use the clearest for episode one and save the rest for follow-ups.",
      "元動画から質問・答え・根拠が続く区間を3つメモ。最も明確な区間を1本目にし、残りは次の候補にします。",
    ],
    licensed: [
      "허용된 사용 범위와 필요한 출처 표기를 메모한 뒤 질문 하나에 답하는 구간을 골라요. 내가 추가할 설명·비교·맥락을 대본에 적고 단순한 장면 모음으로 끝내지 않아요.",
      "Note permitted use and required credit, then select a passage answering one question. Script your own explanation, comparison, or context rather than a clip compilation.",
      "許可範囲と出典表記を記録し、一つの質問に答える区間を選びます。自分の説明や比較を台本に加えましょう。",
    ],
    film: [
      "한 질문을 설명하는 원본을 3~5분 정도 연속 촬영해요. 문제 상황·시연·결론을 모두 담고, 잘못 말해도 촬영을 매번 끊지 말고 문장부터 다시 말해요.",
      "Record a roughly 3–5 minute source covering the problem, demonstration, and conclusion. After a mistake, repeat the sentence rather than restarting every take.",
      "問題・実演・結論を含む3〜5分ほどの元動画を撮ります。言い間違えたら毎回止めず、その文から言い直します。",
    ],
    none: [
      "오늘 주변에서 바로 보여줄 수 있는 소재를 골라 휴대폰으로 3~5분 정도 설명해요. 처음부터 완성된 쇼츠를 찍으려 하지 말고 문제 상황·시연·결론이 담긴 편집용 원본을 준비해요.",
      "Choose something around you and record a roughly 3–5 minute explanation on your phone. Capture a source with problem, demo, and conclusion rather than trying to shoot a perfect finished Short.",
      "身近な素材をスマホで3〜5分ほど説明。完成品を一発で撮ろうとせず、問題・実演・結論のある編集用素材を用意します。",
    ],
    unknown: [
      "다른 사람의 영상에서 참고할 것은 ‘어떤 질문을 다루는지’예요. 오늘은 같은 질문에 내 경험으로 답하는 원본을 직접 촬영하거나 녹화해요. 아래 대본과 촬영안은 이 새 원본으로 실행할 수 있어요.",
      "Use the other video to identify a question, then record your own firsthand answer today. The script and shot plan below work with this new source.",
      "他の動画からは扱う質問を参考にし、今日は自分の経験で答える映像を撮影・録画します。下の台本と撮影案をその素材で進められます。",
    ],
  };
  const sourceAction = tr(
    sourceActions[answers.source || "none"] || sourceActions.none,
  );
  // A separate, contextual note must never replace the executable plan.
  const rightsNote =
    answers.source === "unknown"
      ? l(
          "참고한 타인의 원본 자체를 편집·상업적으로 쓰려면 권한을 먼저 확인해요. 오늘 과제는 직접 만든 원본으로 진행할 수 있어요.",
          "Confirm editing and commercial-use permission before using the reference footage itself. Today’s tasks use your own footage.",
          "参考動画そのものの編集・商用利用は、許可を確認してから。今日の課題は自分の素材で進められます。",
        )
      : "";
  const formats: Record<string, LocalText> = {
    face: [
      "카메라를 눈높이에 두고 첫 문장을 렌즈를 보며 말해요. 설명만 이어가지 말고 핵심 장면을 화면에 보여주고, 마지막에 결론 한 문장으로 돌아와요. 긴 대사는 한 문장씩 나눠 말해도 돼요.",
      "Set the camera at eye level and deliver the hook to the lens. Show the key evidence instead of only talking, then return for a one-sentence conclusion. Record long explanations sentence by sentence.",
      "目線の高さにカメラを置き、冒頭をレンズに向かって話します。証拠の場面を見せてから結論へ。長い説明は一文ずつでも大丈夫です。",
    ],
    hands: [
      "휴대폰을 고정하고 손이 들어와도 핵심 부분이 가려지지 않는 구도를 잡아요. 전체 모습 → 중요한 부분의 가까운 장면 → 결과 순서로 촬영하고, 얼굴 대신 동작과 짧은 자막으로 설명해요.",
      "Fix your phone in place and keep your hands from covering the key detail. Capture an overview, close-up, and result; explain through actions and short captions instead of your face.",
      "スマホを固定し、手で要点を隠さない構図に。全体→寄り→結果の順に撮り、顔の代わりに動きと短い字幕で伝えます。",
    ],
    voice: [
      "먼저 보여줄 화면을 녹화하고 그 순서대로 목소리를 녹음해요. 클릭하거나 움직이기 직전에 무엇을 볼지 말하고, 녹음 전에 개인정보·알림을 가려요. 배경음보다 설명이 잘 들리는지 확인하세요.",
      "Record the screen first and narrate in that order. Explain what to watch before each action; hide personal details and notifications. Keep narration clearer than background sound.",
      "先に画面を録画し、順番に声を入れます。操作の前に見る場所を伝え、個人情報と通知を隠し、声が聞き取りやすいか確認します。",
    ],
    unsure: [
      "첫 편은 얼굴을 공개하지 않는 시연으로 시험해봐요. 같은 장면에 목소리 설명을 붙인 버전과 짧은 자막으로 설명한 버전을 작업 중에 비교하고 더 편한 방식을 골라요. 둘 다 게시할 필요는 없어요.",
      "Try a faceless demonstration first. During editing, compare narration with concise captions and choose the clearer, more comfortable option; you need not publish both.",
      "まず顔を出さない実演を試し、編集中に声の説明と短い字幕を比べて、伝わりやすく楽な方を選びます。両方投稿する必要はありません。",
    ],
  };
  const formatAction = tr(
    formats[answers.format || "unsure"] || formats.unsure,
  );
  const prep = sampleNeeded
    ? l(
        "같은 시청자를 위한 샘플 두 편을 기획해요. 첫 편은 실제 사용·설명, 두 번째는 선택 기준이나 자주 받는 질문에 답하는 구성으로 준비하세요.",
        "Outline two samples for the same audience: one demonstration and one decision guide or FAQ.",
        "同じ視聴者向けに、実演と選び方・質問への回答のサンプルを2本考えます。",
      )
    : missing
      ? l(
          "새 장비나 제품을 사기 전에, 지금 있는 소재로 설명할 수 있는 질문 하나를 고르고 직접 보여줄 증거를 메모해요.",
          "Before buying equipment or products, choose a question you can answer with what you have and list the evidence you can show.",
          "機材や商品を買う前に、今ある素材で答えられる質問と見せられる根拠をメモします。",
        )
      : l(
          "준비된 소재 중 한 가지를 골라 ‘누구의 어떤 고민을 해결하는가’를 한 줄로 적어요. 오늘은 그 한 줄에 맞는 첫 편을 구체화해요.",
          "Choose one ready subject and write whose problem it solves. Today, turn that sentence into your first episode.",
          "準備できた素材を一つ選び、誰のどんな悩みを解決するかを書いて最初の1本にします。",
        );
  const effectivePrep = noOffer
    ? l(
        "판매 페이지부터 만들기보다, 내가 해결할 수 있는 문제 하나와 시청자에게 물어볼 질문 하나를 먼저 적어요. 첫 영상으로 어떤 도움이 필요한지 확인해요.",
        "Before building a sales page, write one problem you can solve and one question to ask viewers. Use the first video to learn what help is needed.",
        "販売ページより先に、解決できる悩みと視聴者への質問を一つずつ書き、最初の動画で必要な助けを確かめます。",
      )
    : prep;
  const today = [
    {
      minutes: minutes[0],
      title: l(
        "시청자와 질문 정하기",
        "Choose a viewer and question",
        "視聴者と質問を決める",
      ),
      body: `${audience}. ${effectivePrep}`,
      done: `${l("메모에 남길 것", "Write down", "残すメモ")}: ${firstHook}`,
    },
    {
      minutes: minutes[1],
      title: ownSourceNeeded
        ? l(
            "첫 원본의 장면 준비하기",
            "Prepare scenes for your source",
            "元動画の場面を準備する",
          )
        : l(
            "첫 편에 쓸 원본 고르기",
            "Select footage for episode one",
            "1本目の素材を選ぶ",
          ),
      body: `${sourceAction} ${tr(topic.evidence)}`,
      done: l(
        "질문·시연·결론이 담긴 촬영 메모 또는 원본의 시작/끝 시간",
        "A question/demo/conclusion shot list or source start/end timestamps",
        "質問・実演・結論の撮影メモ、または素材の開始・終了時刻",
      ),
    },
    {
      minutes: minutes[2],
      title: l(
        "대본과 다음 작업 예약하기",
        "Draft the script and book the next session",
        "台本と次の作業を決める",
      ),
      body: l(
        "아래 첫 번째 대본을 내 경험에 맞게 고치고 소리 내어 읽어봐요. 오늘 끝나지 않은 촬영·편집은 다음 작업 시간에 배정하고, 모르는 내용은 대본에 사실처럼 넣지 않아요.",
        "Adapt the first script below and read it aloud. Put unfinished filming or editing into your next session; leave out claims you cannot support.",
        "下の最初の台本を自分の経験に合わせて読み、残った撮影や編集を次の時間に割り当てます。未確認のことは事実として入れません。",
      ),
      done: l(
        "첫 문장 + 보여줄 증거 + 마지막 안내가 적힌 초안",
        "A draft with a hook, evidence, and closing",
        "冒頭・根拠・最後の案内がある下書き",
      ),
    },
  ];
  const priority = `${l("오늘은", "Today, work on", "今日は")} ‘${subject}’${l("로 첫 편의 질문과 촬영안을 완성해요.", ": finish the question and shot plan for your first video.", "で、最初の質問と撮影案を完成させましょう。")} ${effectivePrep}`;
  const closing = noOffer
    ? l(
        "이 방법을 해볼 때 어디서 막히는지 알려주세요. 다음 영상에서 그 부분을 풀어볼게요.",
        "Tell me where you get stuck trying this; I’ll cover that in the next video.",
        "試して迷う場所を教えてください。次の動画で解説します。",
      )
    : tr(route.closing);
  const scripts = topic.hooks.map((hook, i) => {
    const demonstration = tr(topic.demos[i]);
    return {
      number: i + 1,
      hook: tr(hook),
      body: demonstration,
      shot: `${formatAction} ${tr(topic.evidence)}`,
      ending: closing,
      beats: [
        {
          timing: "0–3s",
          label: l("첫 장면", "Opening", "冒頭"),
          text: tr(hook),
        },
        {
          timing: "3–10s",
          label: l("상황 설명", "Context", "状況"),
          text: l(
            "‘제가 보여드릴 건 [실제로 해본 상황]이에요. 특히 [이런 고민이 있는 사람]이라면 이 부분을 봐주세요.’",
            "‘Here is [a situation I have actually tried]. If you struggle with [this problem], watch this detail.’",
            "「今回は[実際に試した場面]です。[こんな悩みがある方]は、ここを見てください。」",
          ),
        },
        {
          timing: "10–35s",
          label: l("직접 보여주기", "Demonstrate", "実演"),
          text: demonstration,
        },
        {
          timing: "35–45s",
          label: l("판단 기준", "Takeaway", "判断の目安"),
          text: l(
            "‘제가 해본 조건에서는 [관찰한 결과]였어요. [다른 조건]에서는 달라질 수 있으니 [확인할 점]을 먼저 봐주세요.’",
            "‘Under [my test conditions], I observed [result]. With [other conditions] it may differ, so check [key detail].’",
            "「私の[条件]では[確認した結果]でした。[別の条件]では違うこともあるので、[確認点]を見てください。」",
          ),
        },
        {
          timing: "45–55s",
          label: l("다음 행동", "Next step", "次の行動"),
          text: closing,
        },
      ],
    };
  });
  const workflow = [
    {
      title: l(
        "01 · 편집할 원본 준비",
        "01 · Prepare your source",
        "01・編集する素材を用意",
      ),
      body: `${sourceAction} ${l("이지컷 제작 화면에서 해당 입력 방식의 영상 길이와 용량 조건을 확인해요. 조건보다 짧은 테스트 영상은 억지로 반복하지 말고 실제 설명과 시연을 더 촬영해요.", "Check the length and file limits shown for your input method in EasyCut. If a test is too short, record useful explanation and demonstration rather than looping it.", "EasyCutの入力方法ごとの長さ・容量条件を確認。短いテストは繰り返して伸ばさず、必要な説明や実演を追加します。")}`,
    },
    {
      title: l(
        "02 · 이지컷에 원본 입력",
        "02 · Add the source to EasyCut",
        "02・EasyCutに素材を入力",
      ),
      body: l(
        "제작 화면에서 원본 링크 또는 지원되는 업로드 방식을 선택해요. 제목·영상 정보가 의도한 원본인지 확인하고, 화면에 분석 구간 설정이 있으면 질문과 답이 함께 포함되도록 지정해요. 분석·생성이 진행되는 동안 다음 편의 질문을 메모해요.",
        "Choose the source-link or supported upload option. Check the title and source information; if range selection is available, include both question and answer. While processing, outline the next question.",
        "リンクまたは対応するアップロードを選び、タイトルと素材を確認。範囲指定があれば質問と答えを含め、処理中に次の質問をメモします。",
      ),
    },
    {
      title: l(
        "03 · 후보 중 한 편 선택",
        "03 · Choose one candidate",
        "03・候補から1本選ぶ",
      ),
      body: l(
        "생성된 후보를 보고 첫 장면에서 주제가 보이는지, 질문에 답이 있는지, 끝이 갑자기 잘리지 않는지 확인해요. 가장 자극적인 장면보다 한 편만 봐도 이해되는 후보를 먼저 고르고, 나머지는 다음 소재로 남겨요.",
        "Check each candidate for a clear opening, an actual answer, and a complete ending. Choose the self-contained story first and save other candidates for later.",
        "冒頭でテーマが伝わるか、答えがあるか、終わりが切れていないかを確認。単独でわかる1本を選び、残りは次の素材にします。",
      ),
    },
    {
      title: l(
        "04 · 편집기에서 제목·자막 다듬기",
        "04 · Refine the title and captions",
        "04・タイトルと字幕を整える",
      ),
      body: `${l("편집기에서 첫 문장을 위 대본에 맞춰 짧게 정리하고 숫자·고유명사·제품명을 원본과 대조해요. 자막 스타일은 한 가지로 유지하고 세로 화면에서 중요한 장면을 가리는 자막이나 잘린 피사체가 없는지 확인해요.", "Refine the opening using the script and check numbers and names against the source. Keep one caption style and check that text and vertical framing do not hide the evidence.", "台本に合わせて冒頭を短く整え、数字と固有名詞を原本と照合。字幕を統一し、縦画面で要点を隠したり被写体を切ったりしていないか確認します。")} ${l("자막은 배경과 충분히 구분되게 하고, 화면 가장자리보다 안쪽에 놓아요. 미리보기에서 손동작·화면 메뉴·화자의 표정 등 핵심 정보가 가려지는지 살펴요.", "Keep captions distinct from the background and away from the edges. Check that they do not cover hand movements, screen menus, or expressions that matter.", "字幕は背景と区別できる色で端より内側に。手の動き・メニュー・表情など大事な情報を隠していないか確認します。")}`,
    },
    {
      title: l(
        "05 · 휴대폰 검수 후 내려받기",
        "05 · Review on a phone and download",
        "05・スマホで確認して保存",
      ),
      body: l(
        "소리 없이 한 번, 소리를 켜고 한 번 보면서 첫 장면·자막·음량·결론을 점검해요. 완성본을 내려받아 유튜브에서 직접 게시하거나 예약하고, 실제 게시된 영상의 마지막 안내와 연결 위치도 눌러 확인해요.",
        "Watch once muted and once with sound to check the opening, captions, volume, and conclusion. Download, then publish or schedule in YouTube yourself. Test the final call to action on the published video.",
        "無音と音ありで一度ずつ確認し、冒頭・字幕・音量・結論を点検。保存してYouTubeで公開・予約し、公開後の案内先も確認します。",
      ),
    },
  ];
  const deliverable = noOffer
    ? l(
        "문제 해결 영상 1편과 실제 질문 기록",
        "One helpful video and a log of actual questions",
        "悩みを解決する1本と実際の質問メモ",
      )
    : sampleNeeded
      ? l(
          "협업 샘플 초안 2개와 완성 영상 1편",
          "Two sample outlines and one finished video",
          "サンプル案2本と完成動画1本",
        )
      : l(
          "첫 영상 1편과 후속 질문 2개",
          "One finished video and two follow-up questions",
          "完成動画1本と次の質問二つ",
        );
  const pace: Record<string, LocalText> = {
    short: [
      "하루 20분씩 나눠 첫 주에 한 편을 완성하는 예시예요. 편집 처리 대기 시간은 별도이며 더 걸리면 다음 날로 넘겨도 돼요.",
      "An example using 20-minute sessions to finish one video in a week. Processing waits are extra; carry unfinished work to the next session.",
      "1日20分に分けて1週間で1本作る例です。処理待ちは別で、終わらなければ翌日に回して大丈夫です。",
    ],
    medium: [
      "하루 40분 기준으로 촬영과 편집을 다른 날에 배치했어요. 첫 편을 먼저 완성한 뒤 여유가 있으면 두 번째 질문의 촬영까지 진행해요.",
      "This example uses 40-minute sessions on separate filming and editing days. Finish one video before using spare time for the next question.",
      "1日40分の例で撮影と編集を別日に。まず1本完成させ、余裕があれば次の質問を撮影します。",
    ],
    long: [
      "90분 작업 시간을 기획·촬영·편집으로 나눠 써요. 첫 주에는 완성 영상과 비교할 다음 편의 초안을 남기는 것을 목표로 해요.",
      "Use 90-minute sessions split across planning, filming, and editing. Aim for a finished video and a comparison draft for the next episode.",
      "90分を企画・撮影・編集に分け、完成動画と比較する次の下書きを残します。",
    ],
    full: [
      "처음 2시간은 한 편의 전체 과정을 익히는 데 써요. 이후 남는 시간은 소재를 무작정 늘리기보다 다음 두 편의 촬영과 비교 기록에 배분하세요.",
      "Use the first two hours to learn one complete workflow. Put remaining time into filming follow-ups and recording comparisons, not endlessly adding topics.",
      "最初の2時間で一通りの流れを覚え、余った時間は次の撮影や比較記録に使います。",
    ],
    weekend: [
      "토요일은 기획·촬영, 일요일은 편집·검수로 분리해요. 아래 시간은 예시 블록이며 주말 여유에 맞춰 나누고, 평일은 공개 예약과 반응 기록으로 가볍게 운영해요.",
      "Plan and film on Saturday; edit and review on Sunday. Split these example blocks around your availability and use scheduling and brief reviews during the week.",
      "土曜は企画・撮影、日曜は編集・確認。時間は一例なので分割し、平日は予約公開と短い振り返りで進めます。",
    ],
  };
  const timeTip = testMode
    ? l(
        "아직 시간을 모르니 먼저 20분만 써보고 실제 소요 시간을 적어요. 촬영·편집에 걸린 시간을 확인한 뒤 아래 일정을 늘리거나 줄여요.",
        "Start with a 20-minute trial and record actual time. Adjust this schedule after measuring filming and editing.",
        "まず20分試して実際の時間を記録。撮影と編集の時間がわかってから予定を調整しましょう。",
      )
    : tr(pace[timeKey]);
  const days =
    timeKey === "weekend"
      ? [
          l("토요일 · 준비", "Saturday · Plan", "土曜・準備"),
          l("토요일 · 촬영", "Saturday · Film", "土曜・撮影"),
          l("일요일 · 편집", "Sunday · Edit", "日曜・編集"),
          l("일요일 · 공개 준비", "Sunday · Prepare release", "日曜・公開準備"),
          l("다음 주 · 돌아보기", "Next week · Review", "翌週・振り返り"),
        ]
      : [
          l("1일차", "Day 1", "1日目"),
          l("2~3일차", "Days 2–3", "2〜3日目"),
          l("4일차", "Day 4", "4日目"),
          l("5일차", "Day 5", "5日目"),
          l("6~7일차", "Days 6–7", "6〜7日目"),
        ];
  const schedule = [
    {
      when: days[0],
      title: l(
        "첫 편의 기획 확정",
        "Lock the first outline",
        "最初の企画を決める",
      ),
      body: `${effectivePrep} ${stageAction}`,
      output: `${firstHook} / ${audience}`,
    },
    {
      when: days[1],
      title: l(
        "원본과 증거 장면 확보",
        "Capture the source and evidence",
        "元動画と根拠の場面を用意",
      ),
      body: `${sourceAction} ${formatAction}`,
      output: l(
        "질문·시연·결론 원본과 놓치기 쉬운 부분의 가까운 장면",
        "Source with question, demonstration, conclusion, and a close-up of the key detail",
        "質問・実演・結論の元動画と要点の寄りの場面",
      ),
    },
    {
      when: days[2],
      title: l(
        "이지컷으로 첫 편 편집",
        "Edit episode one in EasyCut",
        "EasyCutで1本目を編集",
      ),
      body: `${workflow[2].body} ${l("오늘은 후보 선택과 자막 수정까지 진행하고, 검수는 다음 블록에 남겨요.", "Finish candidate selection and caption correction; leave final review for the next block.", "候補選びと字幕修正まで進め、最終確認は次の時間に残します。")}`,
      output: l(
        "제목·자막을 확인한 첫 편 초안",
        "A first draft with checked title and captions",
        "タイトル・字幕を確認した初稿",
      ),
    },
    {
      when: days[3],
      title: l("확인하고 공개", "Check and publish", "確認して公開"),
      body: `${workflow[4].body} ${noOffer ? effectivePrep : tr(route.steps[2])}`,
      output: l(
        "공개 또는 예약한 영상 링크와 공개 일시 기록",
        "Published or scheduled video link and release date",
        "公開・予約した動画リンクと公開日時",
      ),
    },
    {
      when: days[4],
      title: l(
        "다음에 바꿀 한 가지 선택",
        "Choose the next change",
        "次に変えることを一つ選ぶ",
      ),
      body: l(
        "공개 후 48시간과 7일 시점에 볼 항목을 정해두세요. 아직 기간이 안 지났거나 반응이 적으면 판단을 미루고 질문·제작 시간부터 기록해요. 아래 진단표에서 해당하는 항목 하나를 골라 다음 편에 반영해요.",
        "Plan reviews at 48 hours and seven days. If it is too early or data is sparse, record questions and production time without drawing conclusions. Choose one applicable diagnosis below for your next video.",
        "公開48時間後と7日後に見る項目を決め、早すぎたり反応が少なければ結論を急がず質問と時間を記録。下の診断から一つ次に反映します。",
      ),
      output: `${l("후속 질문", "Next question", "次の質問")}: ${tr(topic.hooks[1])}`,
    },
  ];
  const focuses: Record<
    string,
    { title: LocalText; action: LocalText; measure: LocalText }
  > = {
    ideas: {
      title: [
        "소재를 넓히지 말고 첫 질문을 구체화해요",
        "Make your first question specific",
        "最初の質問を具体的にしよう",
      ],
      action: [
        "‘누구나 궁금해할 정보’ 대신 ‘처음 해보는 사람이 이 단계에서 막히는 이유’를 적어요. 앞에서 정리한 대본 세 개 중 하나를 고르고, 답을 보여줄 장면을 찍을 수 없다면 더 작은 질문으로 바꿔요. 첫 편을 끝내기 전까지 새 주제 수집은 잠시 멈춰요.",
        "Replace broad information with a beginner’s obstacle at one step. Pick one of the scripts above; if you cannot film evidence for the answer, narrow the question. Pause topic hunting until this video is finished.",
        "広い情報ではなく初心者が一つの手順で迷う理由を書きます。上の台本から選び、根拠を撮れなければ質問を小さく。完成まで新テーマ探しを休みましょう。",
      ],
      measure: [
        "한 문장으로 설명되는 질문과 실제로 찍을 수 있는 장면 3개",
        "One clear question and three filmable scenes",
        "一文の質問と撮れる場面三つ",
      ],
    },
    production: {
      title: [
        "가장 오래 걸리는 작업 한 단계 줄이기",
        "Shorten your slowest production step",
        "一番時間がかかる工程を短くする",
      ],
      action: [
        "소재 선택·촬영·생성 대기·편집·검수를 따로 재요. 촬영이 길면 문장 단위로 이어 찍고, 편집이 길면 후보 한 편과 자막 스타일 하나를 먼저 확정해요. 이지컷 생성 중에는 다음 편 대본을 준비하고, 검수 시간을 없애서 속도를 맞추지는 않아요.",
        "Time planning, filming, processing waits, editing, and review separately. Film sentence by sentence if filming is slow; choose one candidate and caption style if editing drags. Draft the next script during processing, preserving review time.",
        "企画・撮影・処理待ち・編集・確認を別々に計測。撮影は一文ずつ、編集は候補と字幕を一つに。待ち時間に次の台本を書き、確認時間は残します。",
      ],
      measure: [
        "완성 한 편에 든 실제 작업 시간과 다시 고친 부분의 수",
        "Hands-on time per finished video and number of rework items",
        "1本の実作業時間と直し直した箇所の数",
      ],
    },
    retention: {
      title: [
        "어디서 넘기는지에 따라 한 군데만 고쳐요",
        "Change one part based on where viewers leave",
        "離れる場所に合わせて一か所直す",
      ],
      action: [
        "첫 장면에서 빠져나가면 완성 결과나 문제 장면을 먼저 보여줘요. 중간에 빠져나가면 답을 늦추는 설명을 줄이고 증거를 앞당겨요. 비슷한 길이·주제·공개 후 기간끼리 비교하고 제목과 영상 내용의 약속이 같은지 확인해요.",
        "If viewers leave immediately, open with the result or problem. If they leave midway, shorten the lead-up and show evidence earlier. Compare similar lengths, topics, and time since release, keeping title and content aligned.",
        "冒頭で離れるなら結果や問題を先に。途中なら前置きを減らし根拠を早めます。長さ・テーマ・公開後の期間を揃えて比べ、タイトルと内容の約束を合わせます。",
      ],
      measure: [
        "첫 구간과 중간 구간의 시청 변화, 실제로 받은 질문",
        "Changes in opening and mid-video viewing, plus actual questions",
        "冒頭と途中の視聴変化、実際の質問",
      ],
    },
    conversion: {
      title: [
        "관심과 수익 사이에 끊기는 지점 찾기",
        "Find the gap between interest and revenue",
        "関心と収益の間で止まる場所を探す",
      ],
      action: [
        "아래 수익화 단계에서 내 영상 이후의 다음 행동을 하나 정해요. 제휴·판매는 안내 페이지까지 직접 따라가고, 협찬은 샘플과 제안 업종의 연결을 확인해요. 광고형은 판매 버튼 대신 시리즈 재방문과 Studio의 수익 창출 상태를 확인해요. 조회수를 구매나 계약과 같은 지표로 취급하지 않아요.",
        "Choose one next action in the earning steps below. Walk affiliate or sales paths yourself; for sponsors, check sample/brand fit; for ads, check series return visits and Earn status. Keep views separate from purchases or contracts.",
        "下の収益化手順で次の行動を一つ決めます。紹介・販売は導線をたどり、案件は作品と業種の相性、広告型は再訪問と収益化状況を確認。再生と購入・契約は分けます。",
      ],
      measure: [
        "영상별 다음 행동과 실제 클릭·문의·회신 또는 구독 반응",
        "Each video’s next action and clicks, inquiries, replies, or subscriptions",
        "動画ごとの次の行動とクリック・相談・返事・登録の反応",
      ],
    },
  };
  const focus = focuses[answers.obstacle || "ideas"] || focuses.ideas;
  const moneySteps = noOffer
    ? [
        effectivePrep,
        tr(route.steps[1]),
        l(
          "들어온 질문을 같은 문제끼리 묶고, 제공할 수 있는 도움·시간·범위를 한 장으로 적어요. 관심 댓글을 실제 구매 의사로 단정하지 말고, 구체적인 상담 요청이나 문제 상황을 더 확인해요.",
          "Group questions by problem and outline the help, time, and scope you could offer. Treat comments as interest, not proof of willingness to buy; learn more from specific requests.",
          "質問を悩み別にまとめ、提供できる助け・時間・範囲を1枚に。コメントを購入意思と決めつけず、具体的な依頼や状況を確かめます。",
        ),
      ]
    : route.steps.map(tr);
  const faqRoute = noOffer ? effectivePrep : moneySteps.join(" ");
  const review = (noOffer ? revenue.explore : route).signals.map((s) => ({
    signal: tr(s.signal),
    action: tr(s.action),
  }));
  const faqs = [
    {
      q: l(
        "오늘 정확히 어디까지 끝내면 되나요?",
        "What exactly should I finish today?",
        "今日はどこまで終わればいい？",
      ),
      a: `${priority} ${l("완료 기준은 대본 첫 문장, 증거 장면, 다음 작업 시간이 정해진 상태예요. 오늘 바로 게시할 필요는 없어요.", "You are done when the opening, evidence scenes, and next session are decided. You do not have to publish today.", "冒頭・根拠の場面・次の作業時間が決まれば完了。今日すぐ投稿しなくても大丈夫です。")}`,
    },
    {
      q: ownSourceNeeded
        ? l(
            "쓸 수 있는 원본이 없으면 어떻게 하죠?",
            "What if I have no usable footage?",
            "使える素材がないときは？",
          )
        : l(
            "원본 하나에서 여러 편을 만들어도 되나요?",
            "Can one source become several videos?",
            "一つの素材から何本も作れる？",
          ),
      a: `${sourceAction} ${tr(topic.evidence)}`,
    },
    {
      q: l(
        "제 시간으로 매일 올려야 하나요?",
        "Do I need to post every day?",
        "毎日投稿しないといけない？",
      ),
      a: `${timeTip} ${l("영상 수보다 한 편을 완성하는 데 걸리는 실제 시간을 먼저 알아두세요. 공개 간격은 그 시간을 기준으로 정하면 돼요.", "Measure the time a complete video actually takes before choosing a posting interval.", "本数より1本にかかる実際の時間を知り、それを基準に投稿間隔を決めましょう。")}`,
    },
    {
      q: l(
        "지금 단계에서 수익화 준비는 어디까지 하나요?",
        "How far should I take monetization preparation now?",
        "今は収益化の準備をどこまで進める？",
      ),
      a: faqRoute,
    },
    {
      q: l(
        "채널의 지금 단계에서는 무엇이 달라지나요?",
        "What changes at my channel’s stage?",
        "今のチャンネル段階だと何が変わる？",
      ),
      a: stageAction,
    },
    {
      q:
        answers.format === "face"
          ? l(
              "말이 자꾸 끊기는데 어떻게 촬영하죠?",
              "How do I film if I keep stumbling?",
              "話が途切れるときはどう撮る？",
            )
          : l(
              "얼굴 없이 어떻게 설득력 있게 보여주죠?",
              "How can a faceless video be convincing?",
              "顔を出さずに説得力を出すには？",
            ),
      a: `${formatAction} ${tr(topic.evidence)}`,
    },
    {
      q: l(
        "지금 막히는 문제는 어떤 순서로 해결하죠?",
        "How should I tackle my main obstacle?",
        "今の悩みはどの順で解決する？",
      ),
      a: `${tr(focus.action)} ${tr(focus.measure)}`,
    },
    {
      q: l(
        "이지컷이 만든 영상을 그대로 올려도 되나요?",
        "Can I publish an EasyCut output immediately?",
        "EasyCutの完成動画はそのまま投稿していい？",
      ),
      a: `${workflow[2].body} ${workflow[4].body}`,
    },
    {
      q: l(
        "몇 편 올려야 성공인지 알 수 있나요?",
        "How many videos tell me whether this works?",
        "何本出せば成功かわかる？",
      ),
      a: l(
        "정해진 편수나 보장된 조회수는 없어요. 먼저 같은 시청자를 위한 작은 시리즈를 만들고 비슷한 공개 기간끼리 비교하세요. 초기 데이터가 적으면 성패를 단정하기보다 제작 시간과 실제 질문을 모으고, 한 가지를 바꾼 다음 편으로 확인해요.",
        "There is no fixed number or guaranteed view count. Start with a small series for one audience and compare similar time windows. With sparse data, record effort and questions, then test one change rather than declaring success or failure.",
        "決まった本数や保証された再生数はありません。同じ視聴者向けの小さなシリーズを同じ公開期間で比較。少ないデータで結論を急がず、時間と質問を集めて一つ変えて試します。",
      ),
    },
  ];
  const guide = recommendedGuide(plan.route);
  return {
    priority,
    today,
    todayMinutes: minutes.reduce((a, b) => a + b, 0),
    sourceNote: rightsNote,
    profile: [
      answerLabel("category", answers.category, locale),
      plan.time.label,
      answerLabel("format", answers.format, locale),
    ].join(" · "),
    audience,
    subject,
    positioning: [tr(route.objective), bridge, stageAction]
      .filter(Boolean)
      .join(" "),
    route: plan.route,
    deliverable,
    focus: {
      title: tr(focus.title),
      action: tr(focus.action),
      measure: tr(focus.measure),
    },
    scripts,
    workflow,
    timeTip,
    schedule,
    revenueSteps: bridge
      ? [bridge + " " + moneySteps[0], ...moneySteps.slice(1)]
      : moneySteps,
    review,
    skip: beginner
      ? l(
          "첫 주에는 장비 구매나 매일 업로드 약속보다 한 편의 완성과 실제 소요 시간 기록에 집중해요.",
          "In week one, focus on finishing a video and recording effort before buying gear or promising daily uploads.",
          "最初の週は機材購入や毎日投稿の約束より、1本完成と時間の記録に集中しましょう。",
        )
      : l(
          "기존에 반응이 나온 형식은 유지하고, 이번 실험에서는 첫 문장·질문·안내 동선 중 한 가지만 바꿔요.",
          "Keep what already works; change only the hook, question, or next-step path in this experiment.",
          "反応のある形を残し、冒頭・質問・案内先の一つだけ変えて試しましょう。",
        ),
    faqs,
    guide,
    bookTitle: textFor(guideCatalog[guide].title, locale),
    bookIntro: l(
      "여기까지가 바로 실행할 수 있는 내 시작 계획이에요. 더 자세한 예시와 이지컷 활용법, 단계별 실습은 아래 실행북에서 이어서 확인해보세요. 표지는 무료로 미리 볼 수 있고, 전체 PDF는 이용 중인 유료 플랜 회원에게 제공돼요.",
      "You now have a plan you can put into action. Continue in the workbook for more examples, EasyCut guidance, and step-by-step exercises. Preview the cover for free; the full PDF is available with an active paid plan.",
      "ここまでで実行できるスタートプランができました。詳しい例やEasyCutの使い方、段階ごとの練習は実践ブックで続けられます。表紙は無料、PDF全文は有料プラン利用中の会員向けです。",
    ),
  };
}
