import type { LocalText } from "@/lib/shorts-guides/catalog";
import type { Route } from "./monetization-model";

type Topic = {
  audience: LocalText;
  subject: LocalText;
  evidence: LocalText;
  hooks: LocalText[];
  demos: LocalText[];
};
export const topics: Record<string, Topic> = {
  products: {
    audience: [
      "구매 전에 실제 사용 모습을 보고 싶은 사람",
      "Someone who wants to see a product in use before buying",
      "買う前に実際の使い方を見たい人",
    ],
    subject: [
      "집에서 자주 쓰는 제품 하나",
      "One product you use at home",
      "家でよく使う商品を一つ",
    ],
    evidence: [
      "놓을 공간의 크기, 실제 작동 모습, 사용 후 정리까지 같은 구도로 찍어요. 제품명과 사용 조건을 함께 메모하세요.",
      "Film its fit, operation, and cleanup from a consistent angle. Note the product name and conditions.",
      "置く場所のサイズ、動作、片付けまで同じ構図で撮り、商品名と使用条件もメモしましょう。",
    ],
    hooks: [
      [
        "이거 사기 전에, 놓을 자리부터 재보세요.",
        "Before buying this, measure where it will go.",
        "これを買う前に、置く場所を測ってみて。",
      ],
      [
        "제가 이 제품을 계속 쓰는 이유는 딱 하나예요.",
        "There’s one reason I keep using this.",
        "これを使い続けている理由は一つです。",
      ],
      [
        "이런 용도라면, 이 제품은 다시 생각해보세요.",
        "If you need it for this, think twice.",
        "この用途なら、買う前にもう一度考えて。",
      ],
    ],
    demos: [
      [
        "자로 공간과 제품을 차례로 재고, 실제 놓은 모습과 걸리는 부분을 보여줘요.",
        "Measure the space and product, then show the fit and any obstruction.",
        "場所と商品を順に測り、置いた状態と邪魔になる部分を見せます。",
      ],
      [
        "평소 불편했던 작업을 먼저 보여준 뒤 제품으로 같은 작업을 해요. 편해진 부분과 여전히 손이 가는 부분을 짚어요.",
        "Show an everyday task, then do it with the product. Point out what gets easier and what still takes effort.",
        "普段の作業を見せてから商品を使い、楽になる点と手間が残る点を伝えます。",
      ],
      [
        "사용하기 편한 상황과 불편한 상황을 하나씩 시연하고, 누구에게 맞는지 정리해요.",
        "Demonstrate one good use case and one poor fit, then name who it suits.",
        "向いている使い方と不向きな使い方を一つずつ実演します。",
      ],
    ],
  },
  knowledge: {
    audience: [
      "처음 해보다가 한 단계에서 막힌 입문자",
      "A beginner stuck on one step",
      "一つの手順でつまずいている初心者",
    ],
    subject: [
      "내가 직접 설명하고 시연할 수 있는 작업 하나",
      "One task you can explain and demonstrate",
      "自分で説明して実演できる作業を一つ",
    ],
    evidence: [
      "시작 화면, 헷갈리는 선택, 완료 화면을 직접 녹화해요. 개인정보는 가리고, 설명할 메뉴 이름을 적어두세요.",
      "Record the starting screen, confusing choice, and completed result. Hide personal information and note menu names.",
      "開始画面、迷う選択、完成画面を録画し、個人情報を隠してメニュー名をメモします。",
    ],
    hooks: [
      [
        "여기서 막혔다면, 이 순서로 한번 해보세요.",
        "Stuck here? Try this order.",
        "ここでつまずいたら、この順でやってみて。",
      ],
      [
        "처음 할 때 제가 헷갈렸던 건 이 부분이에요.",
        "This is the part that confused me at first.",
        "最初に私が迷ったのは、ここでした。",
      ],
      [
        "두 방법 중 무엇을 쓸지, 이 기준으로 고르세요.",
        "Use this rule to choose between these two methods.",
        "二つの方法で迷ったら、この基準で選んで。",
      ],
    ],
    demos: [
      [
        "문제가 난 화면을 보여주고 해결 동작을 순서대로 시연해요. 마지막에 성공 여부를 확인하는 위치를 짚어요.",
        "Show the problem, demonstrate the fix in order, and point to where success is visible.",
        "困った画面から順に解決し、最後に成功を確かめる場所を示します。",
      ],
      [
        "헷갈리는 두 선택지를 같은 화면에 두고 차이를 설명한 뒤 실제로 하나를 선택해 결과를 보여줘요.",
        "Show the two confusing choices, explain the difference, then use one and show the result.",
        "迷う二つの選択肢の違いを説明し、一つを選んで結果を見せます。",
      ],
      [
        "같은 작은 작업을 두 방식으로 해보고, 단계 수나 수정 편의처럼 직접 확인할 수 있는 차이를 비교해요.",
        "Do a small task both ways and compare observable differences such as steps or ease of revision.",
        "同じ小さな作業を二通りで試し、手順や修正のしやすさを比べます。",
      ],
    ],
  },
  food: {
    audience: [
      "한 끼를 직접 만들고 싶은 요리 입문자",
      "A beginner making a meal at home",
      "家で一食作ってみたい料理初心者",
    ],
    subject: [
      "이번 주 실제로 만드는 요리 하나",
      "One dish you are actually cooking this week",
      "今週実際に作る料理を一つ",
    ],
    evidence: [
      "재료 양, 불 세기, 익은 상태를 가까이 찍어요. 완성 접시뿐 아니라 질감이 달라지는 순간을 남겨요.",
      "Capture quantities, heat setting, and doneness up close. Film the texture change as well as the finished plate.",
      "分量、火加減、火の通りを近くで撮り、完成品だけでなく変化する瞬間を残します。",
    ],
    hooks: [
      [
        "이 요리, 저는 이 상태가 되면 불을 줄여요.",
        "When it looks like this, I turn the heat down.",
        "この料理、私はこの状態で火を弱めます。",
      ],
      [
        "냉장고에 이 재료 남았다면 이렇게 써보세요.",
        "Got this left in the fridge? Try this.",
        "冷蔵庫にこれが残っていたら、試してみて。",
      ],
      [
        "같은 재료를 다르게 익히면 이렇게 달라져요.",
        "Here’s what changes when you cook it another way.",
        "同じ食材でも、火の入れ方でこう変わります。",
      ],
    ],
    demos: [
      [
        "완성 모습을 먼저 보여주고 익기 전·중간·완성 상태를 비교해요. 불을 조절하는 순간과 판단 기준을 설명해요.",
        "Open with the dish, compare stages of cooking, and explain the cue for changing heat.",
        "完成品から始め、途中の状態と火加減を変える目安を見せます。",
      ],
      [
        "남은 재료와 분량을 보여주고 핵심 조리 단계 두 개만 설명해요. 맛이나 식감은 직접 느낀 범위에서 말해요.",
        "Show the leftovers and quantities, explain two key steps, and describe your own taste experience.",
        "残った食材と量を見せ、要点を二つに絞り、自分で感じた味や食感を伝えます。",
      ],
      [
        "같은 분량을 두 방식으로 조리해 단면과 질감을 보여주고 어떤 음식에 어울리는지 설명해요.",
        "Cook equal portions two ways, show the texture, and explain which dish each suits.",
        "同量を二通りで調理し、断面と食感、合う料理を伝えます。",
      ],
    ],
  },
  beauty: {
    audience: [
      "자신의 사용 조건에 맞는 제품·스타일을 찾는 사람",
      "Someone choosing a product or style for their needs",
      "自分に合う商品やスタイルを探している人",
    ],
    subject: [
      "직접 써본 아이템 또는 옷 한 벌",
      "An item or outfit you have actually used",
      "実際に使ったアイテムや服を一つ",
    ],
    evidence: [
      "같은 조명에서 발색·질감·핏을 찍고 사용한 양이나 사이즈를 적어요. 보정 효과와 실제 차이를 섞지 않아요.",
      "Use consistent lighting for color, texture, or fit; note quantity or size. Keep editing effects separate from real differences.",
      "同じ照明で色・質感・形を撮り、使用量やサイズを記録。加工と実際の変化は分けます。",
    ],
    hooks: [
      [
        "같은 아이템도 이렇게 쓰면 느낌이 달라져요.",
        "One item, two very different looks.",
        "同じアイテムでも、使い方で雰囲気が変わります。",
      ],
      [
        "색상 고르기 전에 이 조명에서도 확인해보세요.",
        "Check the color in this light before choosing.",
        "色を選ぶ前に、この光でも見てみて。",
      ],
      [
        "직접 써보니, 이 점은 미리 알면 좋겠어요.",
        "After trying it, here’s what I wish I’d known.",
        "使ってみて、先に知りたかったのはここ。",
      ],
    ],
    demos: [
      [
        "아이템을 먼저 보여주고 두 가지 연출을 같은 구도로 비교해요. 어디에 입거나 쓰기 좋은지 한 상황씩 붙여요.",
        "Show the item and two looks from the same angle, with one occasion for each.",
        "同じ構図で二つの使い方を比べ、それぞれ合う場面を伝えます。",
      ],
      [
        "실내와 창가에서 같은 부위를 촬영해 색상 차이를 보여줘요. 촬영 조건을 함께 말해요.",
        "Film the same area indoors and by a window, explaining the lighting conditions.",
        "室内と窓辺で同じ部分を撮り、照明条件と色の違いを説明します。",
      ],
      [
        "준비 과정부터 사용 후까지 보여주고, 편했던 점과 번거로웠던 점을 실제 장면으로 짚어요.",
        "Show setup through use, pointing to a convenient detail and a drawback.",
        "準備から使用後まで見せ、便利な点と手間のかかる点を示します。",
      ],
    ],
  },
  gaming: {
    audience: [
      "같은 구간에서 자주 실패하는 초보 플레이어",
      "A new player struggling with the same section",
      "同じ場面で失敗しがちな初心者プレイヤー",
    ],
    subject: [
      "직접 플레이한 한 상황이나 기술",
      "One situation or skill from your own gameplay",
      "自分のプレイから一つの場面や技",
    ],
    evidence: [
      "실패와 성공 장면, 입력 시점, 결과 화면을 자기 플레이로 녹화해요. 게임 버전과 조건을 메모하세요.",
      "Record your own failed and successful attempts, input timing, and results. Note the version and conditions.",
      "自分の失敗・成功、操作のタイミング、結果を録画し、バージョンと条件をメモします。",
    ],
    hooks: [
      [
        "여기서 계속 실패한다면, 누르는 타이밍을 봐보세요.",
        "Keep failing here? Watch the input timing.",
        "ここで失敗するなら、押すタイミングを見て。",
      ],
      [
        "이 장면에서 제가 바꾼 건 딱 하나예요.",
        "I changed just one thing in this play.",
        "この場面で変えたのは一つだけ。",
      ],
      [
        "처음 시작할 때 이 설정부터 확인해보세요.",
        "Starting out? Check this setting first.",
        "始めたばかりなら、この設定を見てみて。",
      ],
    ],
    demos: [
      [
        "실패 직전부터 보여주고 입력 타이밍을 표시해요. 성공 장면과 나란히 설명하며 바뀐 행동을 하나만 짚어요.",
        "Show the lead-up to failure, mark timing, and compare the successful attempt around one change.",
        "失敗の直前からタイミングを示し、成功時との違いを一つ説明します。",
      ],
      [
        "같은 상황에서 이전 행동과 바꾼 행동을 보여줘요. 왜 바꿨는지와 통하지 않는 조건을 함께 설명해요.",
        "Compare your old and new action in the same situation, explaining why and when it may not work.",
        "同じ状況で以前と変更後を見せ、理由と通用しない条件も伝えます。",
      ],
      [
        "설정 화면의 위치와 변경값을 보여준 뒤 자기 플레이에서 차이를 설명해요. 만능 설정처럼 말하지 않아요.",
        "Show the setting and value, then demonstrate the difference in your play without calling it universal.",
        "設定の場所と値を示し、自分のプレイでの違いを説明します。",
      ],
    ],
  },
  life: {
    audience: [
      "같은 취미·장소를 처음 경험하려는 사람",
      "Someone trying your hobby or destination for the first time",
      "同じ趣味や場所を初めて体験する人",
    ],
    subject: [
      "직접 가본 장소나 반복하는 취미 활동",
      "A place you visited or hobby you practise",
      "自分で訪れた場所や続けている趣味",
    ],
    evidence: [
      "준비물, 이동 과정, 실제 경험 장면을 찍고 날짜와 소요 시간을 메모해요. 가격·운영 정보는 확인한 시점을 붙여요.",
      "Capture preparation, the journey, and the experience. Note date and duration; date any price or opening information.",
      "準備、移動、体験を撮り、日付と所要時間を記録。料金や営業情報には確認時点を添えます。",
    ],
    hooks: [
      [
        "여기 처음 간다면, 저는 이것부터 챙길 거예요.",
        "Going here for the first time? I’d bring this.",
        "初めてここに行くなら、私はこれを用意します。",
      ],
      [
        "이 취미를 시작하기 전에 알았으면 좋았을 것.",
        "What I wish I knew before starting this hobby.",
        "この趣味を始める前に知りたかったこと。",
      ],
      [
        "제 일상이 편해진 작은 순서 하나를 보여드릴게요.",
        "One small routine that made my day easier.",
        "毎日が少し楽になった手順を一つ紹介します。",
      ],
    ],
    demos: [
      [
        "현장에서 필요했던 물건과 쓰는 장면을 보여주고, 안 챙겼을 때의 불편을 직접 경험한 범위에서 설명해요.",
        "Show an item in use on location and the inconvenience you personally experienced without it.",
        "現地で使う場面を見せ、持たずに困った自分の経験を説明します。",
      ],
      [
        "처음 준비한 것과 실제로 필요했던 것을 나눠 보여줘요. 다음에 다시 시작한다면 바꿀 점을 하나 말해요.",
        "Compare what you prepared with what you needed, then name one thing you’d change.",
        "最初に用意したものと実際に必要だったものを比べ、変えたい点を一つ伝えます。",
      ],
      [
        "기존 동선과 바꾼 동선을 직접 촬영해요. 소요 시간이나 준비물처럼 확인할 수 있는 차이를 보여줘요.",
        "Film the old and new routine and compare something observable, such as time or equipment.",
        "前後の手順を撮り、時間や道具など確認できる違いを示します。",
      ],
    ],
  },
  talk: {
    audience: [
      "긴 강의·대화에서 핵심 답을 빨리 찾고 싶은 사람",
      "Someone looking for a clear answer in a long talk",
      "長い講義や対話から要点を知りたい人",
    ],
    subject: [
      "인터뷰·강의에서 질문 하나에 답하는 구간",
      "A passage answering one question in a talk",
      "対話や講義で一つの質問に答える部分",
    ],
    evidence: [
      "질문, 답변, 실제 사례가 이어지는 구간의 시작·끝 시간을 적어요. 화자의 단서와 예외가 잘리지 않도록 원본을 들어보세요.",
      "Mark the start and end of a question, answer, and example. Listen for qualifications that the edit must retain.",
      "質問・答え・例が続く開始と終了時刻をメモし、条件や例外を切らないよう聞き直します。",
    ],
    hooks: [
      [
        "이 질문에 대한 답은, 이 사례에 담겨 있어요.",
        "This example answers the question.",
        "この質問の答えは、この例にあります。",
      ],
      [
        "이 말은 앞의 조건까지 들어야 이해돼요.",
        "This point makes sense when you hear the condition.",
        "この話は、前提まで聞くとわかります。",
      ],
      [
        "긴 설명에서 오늘 써볼 수 있는 한 가지만 골랐어요.",
        "One thing from this talk you can try today.",
        "長い説明から、今日試せることを一つ。",
      ],
    ],
    demos: [
      [
        "질문을 짧게 표시하고 답변의 핵심과 실제 사례를 연결해요. 화자가 말한 결론으로 마무리해요.",
        "Show the question briefly, connect the answer to its example, and finish with the speaker’s conclusion.",
        "質問を短く示し、答えと例をつなげ、話し手の結論で締めます。",
      ],
      [
        "단정적으로 들릴 수 있는 문장 앞의 조건을 먼저 제시해요. 해당하는 경우와 아닌 경우를 원본에 맞게 살려요.",
        "Introduce the condition before the strong claim, preserving when it does and does not apply.",
        "強い言い切りの前に条件を置き、当てはまる場合と例外を残します。",
      ],
      [
        "실천할 동작 하나와 그 이유를 남겨요. 마지막에 시청자가 자기 상황에 적용할 질문을 던져요.",
        "Keep one actionable step and its reason; close with a question viewers can apply to themselves.",
        "実践する行動と理由を一つ残し、自分に当てはめられる問いで締めます。",
      ],
    ],
  },
  unsure: {
    audience: [
      "내가 겪었던 작은 문제를 지금 겪는 사람",
      "Someone facing a small problem you have solved",
      "自分が経験した小さな悩みを抱えている人",
    ],
    subject: [
      "친구에게 자주 설명하는 일이나 매일 쓰는 물건",
      "Something you explain to friends or use every day",
      "友人によく説明することや毎日使うもの",
    ],
    evidence: [
      "직접 보여줄 수 있는 소재 세 개를 적고, 지금 촬영 가능한 것 하나를 골라요. 준비물·과정·결과를 자기 장면으로 남겨요.",
      "List three things you can show firsthand; pick one you can film now. Capture preparation, process, and result.",
      "自分で見せられる素材を三つ書き、今撮れる一つを選んで準備・過程・結果を撮ります。",
    ],
    hooks: [
      [
        "친구가 자주 물어보는 이 질문, 직접 보여드릴게요.",
        "Friends keep asking this—let me show you.",
        "よく聞かれるこの質問、実際に見せます。",
      ],
      [
        "매일 쓰는 이것, 저는 이렇게 활용해요.",
        "Here’s how I use this everyday item.",
        "毎日使うこれ、私はこう使っています。",
      ],
      [
        "처음 해보니 예상과 달랐던 한 가지.",
        "One thing that surprised me when I tried this.",
        "初めて試して、予想と違ったことを一つ。",
      ],
    ],
    demos: [
      [
        "질문에 답하는 동작 하나를 직접 시연하고, 사람들이 헷갈리는 부분을 가까이 보여줘요.",
        "Demonstrate one action that answers the question and show the confusing detail up close.",
        "答えになる動作を実演し、迷いやすい部分を近くで見せます。",
      ],
      [
        "평소 쓰는 장면과 나만의 작은 활용법을 보여주고 누구에게 도움이 되는지 설명해요.",
        "Show normal use and your own small tip, then explain who it helps.",
        "普段の使い方と自分の工夫を見せ、誰に役立つか伝えます。",
      ],
      [
        "시도 전의 예상과 실제 과정을 보여주고, 다음에 바꿀 점 하나를 말해요.",
        "Compare your expectation with what happened and name one change for next time.",
        "予想と実際の過程を見せ、次に変えることを一つ伝えます。",
      ],
    ],
  },
};

type Revenue = {
  objective: LocalText;
  steps: LocalText[];
  closing: LocalText;
  signals: { signal: LocalText; action: LocalText }[];
};
export const revenue: Record<Route, Revenue> = {
  affiliate: {
    objective: [
      "제품 선택을 돕는 영상에서 구매 안내까지 연결하기",
      "Connect a helpful review to clear buying information",
      "商品選びに役立つ動画から購入案内へつなぐ",
    ],
    steps: [
      [
        "실제로 설명할 수 있는 제품 하나를 정하고 ‘어떤 사람에게, 어떤 상황에서 필요한가’를 적어요. 제휴 서비스의 가입·게시 조건과 해당 상품의 연결 가능 여부를 확인해요.",
        "Choose a product you know and write who needs it and when. Check your affiliate service’s participation, publishing, and product-link requirements.",
        "説明できる商品を選び、誰がいつ必要とするかを書きます。利用するサービスの参加・掲載条件と商品リンクを確認しましょう。",
      ],
      [
        "리뷰 한 편에 해결할 고민은 하나만 담아요. 실제 사용 장면 → 선택 기준 → 아쉬운 점 → 맞는 사람 순서로 설명하고, 제휴 관계는 알아보기 쉽게 표시해요.",
        "Answer one buying question per review: show use, selection criteria, a drawback, and the right user. Make the affiliate relationship clear.",
        "一つの購入前の悩みに絞り、使用・選ぶ基準・気になる点・向いている人を伝え、広告関係もわかりやすく示します。",
      ],
      [
        "쇼츠 설명·댓글에 URL만 붙여 끝내지 말고 채널 프로필의 안내 링크까지 휴대폰에서 직접 이동해봐요. 영상 주제별로 제휴 보고서의 클릭·주문을 따로 적어 어떤 질문이 구매 고민과 가까운지 살펴요.",
        "Test the path through your channel profile on a phone, rather than relying on a Shorts description or comment URL. Record affiliate clicks and orders by topic to identify buying questions.",
        "説明欄やコメントのURLだけに頼らず、スマホでプロフィールの案内先まで進みます。テーマごとにクリックと注文を分けて記録します。",
      ],
    ],
    closing: [
      "이런 용도로 찾는 분이라면 참고해보세요. 제가 쓴 제품과 확인할 점은 채널 프로필에 정리해둘게요.",
      "If this is your use case, the product and things to check are in my channel profile.",
      "この用途で探している方は参考に。使った商品と確認点はプロフィールにまとめます。",
    ],
    signals: [
      {
        signal: [
          "조회는 있는데 구매 안내로 이동하지 않아요",
          "Views, but few visits to buying information",
          "見られるのに案内先へ進まない",
        ],
        action: [
          "마지막 안내가 ‘좋아요’로 끝나는지 확인해요. 다음 편에서는 제품이 맞는 사람과 프로필에서 얻을 정보를 한 문장으로 연결해요.",
          "Check whether your closing only asks for likes. Next time, connect the intended user to what they will find in your profile.",
          "最後が「いいね」だけになっていないか確認。次は向いている人と案内先の情報を一文でつなげます。",
        ],
      },
      {
        signal: [
          "클릭은 있는데 주문이 적어요",
          "Clicks, but few orders",
          "クリックされるのに注文が少ない",
        ],
        action: [
          "품절·가격·옵션과 영상의 소개 내용이 맞는지 직접 확인해요. 비교·크기·단점처럼 구매 직전 질문을 다음 편으로 만들어요.",
          "Check stock, price, options, and whether the listing matches your video. Cover a final buying question such as size or limitations next.",
          "在庫・価格・選択肢と動画の内容を確認し、サイズや弱点など購入前の疑問を次に扱います。",
        ],
      },
      {
        signal: [
          "주문은 나지만 제작 시간이 너무 길어요",
          "Orders arrive, but production takes too long",
          "注文はあるが制作に時間がかかる",
        ],
        action: [
          "반응이 나온 제품의 다른 질문을 같은 촬영 자리에서 준비해요. 제작 시간과 확정 수수료를 함께 기록하고 취소·반품 반영 후 판단해요.",
          "Batch another question about the same product. Track production time against confirmed commission after cancellations and returns.",
          "同じ商品の別の質問をまとめ撮りし、制作時間とキャンセル・返品反映後の報酬を記録します。",
        ],
      },
    ],
  },
  ads: {
    objective: [
      "같은 시청자가 다음 편도 보는 시리즈 만들기",
      "Build a series the same viewer wants to return to",
      "同じ視聴者が次も見たくなるシリーズを作る",
    ],
    steps: [
      [
        "채널 약속을 ‘누구의 어떤 질문에 답하는가’로 한 문장에 적어요. 같은 시청자가 이어서 궁금해할 질문 3개를 각각 한 편으로 나눠요.",
        "Write your channel promise as whose question you answer. Split three follow-up questions for that viewer into separate episodes.",
        "誰のどんな疑問に答えるかを一文にし、続けて知りたくなる質問を3本に分けます。",
      ],
      [
        "각 편은 그 영상만 봐도 답을 얻도록 완성하고, 끝에서 다음 편의 구체적인 질문을 예고해요. 첫 장면·길이·자막을 동시에 바꾸지 말고 한 요소씩 실험해요.",
        "Make each episode useful on its own, then tease a specific next question. Change one variable at a time, not opening, length, and captions together.",
        "1本だけでも答えが得られる構成にし、次の具体的な質問を予告。冒頭・長さ・字幕は一つずつ試します。",
      ],
      [
        "유튜브 스튜디오에서 영상별 시청 지속과 구독 반응을 비교하고 수익 창출 메뉴에서 내 채널의 신청 상태를 확인해요. 광고 수익은 별도의 자격 요건과 심사를 거치므로 첫 주 목표는 시리즈 완성과 개선 기록으로 잡아요.",
        "Compare watch duration and subscriptions in Studio and check Earn for your channel’s application status. Eligibility and review are separate, so aim first to complete and improve a series.",
        "Studioで視聴時間や登録の反応を比べ、収益化画面で申請状況を確認。条件と審査は別なので、まずシリーズ完成と改善を目標にします。",
      ],
    ],
    closing: [
      "다음 편에서는 이걸 실제로 적용할 때 막히는 부분을 보여드릴게요. 지금 가장 궁금한 점도 남겨주세요.",
      "Next, I’ll show the part that gets tricky in practice. Tell me what you want answered.",
      "次は実際に試すと迷いやすい部分を見せます。気になる点も教えてください。",
    ],
    signals: [
      {
        signal: [
          "시작하자마자 넘기는 반응이 많아요",
          "Viewers leave at the opening",
          "冒頭で離れられる",
        ],
        action: [
          "인사보다 결과 장면을 먼저 보여줘요. 같은 주제의 다음 편에서 첫 문장만 바꾸고 공개 후 같은 기간의 반응을 비교해요.",
          "Show the result before an introduction. Change only the opening in a related episode and compare equal periods after publication.",
          "挨拶より先に結果を見せ、次は冒頭だけ変えて公開後の同じ期間で比べます。",
        ],
      },
      {
        signal: [
          "처음은 보는데 중간에 이탈해요",
          "People start watching but leave midway",
          "途中で離れられる",
        ],
        action: [
          "답이 나오기 전의 반복 설명을 줄여요. 중요한 증거 장면을 앞당기고, 삭제해도 뜻이 통하는 문장을 하나 덜어내요.",
          "Shorten repetition before the answer. Bring evidence forward and remove a sentence that adds no meaning.",
          "答えまでの繰り返しを減らし、証拠になる場面を前へ。なくても伝わる一文を削ります。",
        ],
      },
      {
        signal: [
          "한 편만 보고 다음 편으로 이어지지 않아요",
          "One video works, but viewers do not continue",
          "1本だけで次につながらない",
        ],
        action: [
          "잘된 영상의 시청자가 다음에 할 질문을 골라요. 무관한 유행 주제로 바꾸기 전에 같은 문제의 다음 단계를 제작해요.",
          "Choose that viewer’s next question. Cover the next step of the same problem before switching to an unrelated trend.",
          "その視聴者の次の疑問を選び、別の流行より先に同じ悩みの続きを作ります。",
        ],
      },
    ],
  },
  sponsor: {
    objective: [
      "브랜드가 맡길 일을 이해할 수 있는 샘플과 제안 만들기",
      "Create samples and a proposal that show what a brand can commission",
      "ブランドが依頼内容を想像できるサンプルと提案を作る",
    ],
    steps: [
      [
        "자연스럽게 소개할 수 있는 업종 하나를 정하고, 사용 상황을 보여주는 샘플과 질문에 답하는 샘플을 준비해요. 실제 계약이 없는 샘플은 자율 제작임을 구분해요.",
        "Choose one relevant industry and prepare a use-case sample and a question-led sample. Distinguish self-initiated samples from paid work.",
        "合う業種を一つ選び、使用場面と質問への回答のサンプルを準備。自主制作と実案件は区別します。",
      ],
      [
        "소개서 한 장에 채널 주제, 시청자 특징, 대표 영상 링크, 측정 기간이 있는 성과, 제안할 영상 한 편의 구성을 넣어요. 팔로워 수만 나열하지 말고 어떤 구매 고민을 풀어줄지 적어요.",
        "Put topic, audience, sample links, dated performance, and one proposed video outline on a single page. Explain the customer question you can address.",
        "テーマ・視聴者・作品リンク・期間付き実績・提案する1本の構成を1枚にまとめます。解決できる購入前の悩みも書きます。",
      ],
      [
        "제품과 시청자가 맞는 브랜드 후보 5곳을 적고, 각 브랜드에 맞는 아이디어를 한 문장씩 준비해요. 제작물·수정 횟수·납기·게시 기간·2차 활용 범위와 대가를 나눠 협의해요.",
        "List five well-matched brands and one tailored idea for each. Discuss deliverables, revisions, deadlines, posting duration, reuse, and compensation separately.",
        "相性のよい5社と各社向けの案を用意。制作物・修正回数・納期・掲載期間・二次利用・報酬を分けて相談します。",
      ],
    ],
    closing: [
      "이 제품이 어떤 상황에 맞는지 궁금한 점을 남겨주세요. 실제 사용 장면으로 다음 편에서 보여드릴게요.",
      "Ask which situations this product suits; I’ll demonstrate one in the next video.",
      "どんな場面に合うか気になる点を教えてください。次は実際に見せます。",
    ],
    signals: [
      {
        signal: [
          "제안에 회신이 없어요",
          "No replies to proposals",
          "提案に返事がない",
        ],
        action: [
          "같은 제안을 더 보내기 전에 브랜드 제품과 내 시청자의 연결을 첫 문장에 적어요. 대표 링크는 관련성 높은 1~2개로 줄여요.",
          "Before sending more, lead with the fit between the product and your audience. Keep only one or two relevant sample links.",
          "数を増やす前に商品と視聴者の相性を冒頭に書き、作品リンクを1〜2本に絞ります。",
        ],
      },
      {
        signal: [
          "대화는 시작됐는데 계약이 안 돼요",
          "Conversations start but do not close",
          "話は進むが契約にならない",
        ],
        action: [
          "영상 한 편에 포함되는 작업과 추가 비용 항목을 분리해요. 상대가 원하는 것이 인지도인지 사용법 설명인지 먼저 확인해요.",
          "Separate included work from extras. Clarify whether the brand wants awareness or a product demonstration.",
          "含まれる作業と追加項目を分け、認知拡大か使い方説明か目的を確認します。",
        ],
      },
      {
        signal: [
          "제작할수록 수정 부담이 커져요",
          "Revisions keep growing",
          "修正の負担が増える",
        ],
        action: [
          "촬영 전에 대본·필수 표현·금지 표현을 확인받고, 합의한 수정 범위를 기록해요. 다음 견적에는 실제 투입 시간을 반영해요.",
          "Agree on script, required and excluded claims before filming, record revision scope, and price future work using actual time.",
          "撮影前に台本と必須・不可表現を確認し、修正範囲を記録。次の見積もりに実作業時間を反映します。",
        ],
      },
    ],
  },
  sales: {
    objective: [
      "고객의 질문에 답하고 상품·상담의 다음 단계로 연결하기",
      "Answer a customer question and connect it to an offer or consultation",
      "顧客の疑問に答え、商品や相談へつなぐ",
    ],
    steps: [
      [
        "상품이 있다면 구매 전에 받은 질문을 모아 가장 반복되는 하나를 골라요. 없다면 잘 해결할 수 있는 문제에 대한 질문을 모으고 필요한 도움을 확인해요.",
        "With an offer, pick a recurring pre-purchase question. Without one, collect questions about a problem you can solve to learn what help is wanted.",
        "商品があれば購入前によく聞かれる質問を選び、なければ解決できる悩みの質問から必要な助けを探ります。",
      ],
      [
        "영상에서 작은 문제 하나는 끝까지 해결해줘요. 시청자가 따라 할 수 있는 예시를 보여주고, 상품·상담에서는 무엇을 더 도와주는지 구분해요.",
        "Solve one small problem fully in the video. Show an example viewers can use and distinguish the extra help your offer provides.",
        "動画で小さな悩みを一つ解決し、試せる例を見せ、商品や相談で追加できる助けを分けて伝えます。",
      ],
      [
        "연결 페이지 첫 화면에 대상·제공 내용·다음 행동을 적어요. 모바일에서 문의나 구매 직전까지 동선을 확인하고, 조회·방문·문의·구매를 별도로 기록해요.",
        "Put the audience, deliverable, and next action at the top of the destination page. Test the mobile path without submitting a purchase; log views, visits, inquiries, and purchases separately.",
        "案内先の最初に対象・提供内容・次の行動を示し、購入は確定せずスマホで導線を確認。再生・訪問・相談・購入を分けて記録します。",
      ],
    ],
    closing: [
      "직접 해보고 여기서 막혔다면, 프로필에서 어떤 도움을 받을 수 있는지 확인해보세요.",
      "If you tried this and got stuck, see my profile for the help available.",
      "試してここで困ったら、プロフィールで受けられるサポートを見てみてください。",
    ],
    signals: [
      {
        signal: [
          "조회는 있는데 문의가 없어요",
          "Views, but no inquiries",
          "再生されるが相談がない",
        ],
        action: [
          "정보만 궁금한 사람과 도움이 필요한 사람을 구분해요. 다음 편은 비용·진행 방식·적합한 대상 같은 구매 전 질문을 다뤄요.",
          "Separate curiosity from a need for help. Answer a pre-purchase question about process, cost, or fit next.",
          "情報への興味と助けの必要性を分け、次は費用・進め方・対象など購入前の疑問を扱います。",
        ],
      },
      {
        signal: [
          "페이지 방문은 있는데 신청이 없어요",
          "Visits, but no applications",
          "ページには来るが申し込まれない",
        ],
        action: [
          "영상에서 약속한 내용이 첫 화면에 있는지 확인해요. 가격·제공 범위·연락 방법 중 빠진 정보를 채우고 행동 버튼을 하나로 정리해요.",
          "Check that the first screen matches the video. Add missing price, scope, or contact details and choose one main action.",
          "動画の約束が最初の画面にあるか確認し、価格・範囲・連絡先を補い、主な行動を一つにします。",
        ],
      },
      {
        signal: [
          "문의는 오는데 구매가 안 돼요",
          "Inquiries, but few purchases",
          "相談は来るが購入につながらない",
        ],
        action: [
          "문의 내용을 유형별로 적고, 반복되는 망설임 하나를 다음 영상에서 설명해요. 무조건 할인하기 전에 대상과 제공 범위가 맞는지 확인해요.",
          "Group inquiries and answer a recurring hesitation in your next video. Check audience and scope before discounting.",
          "相談を分類し、よくある迷いを次の動画で説明。値下げの前に対象と提供範囲を確認します。",
        ],
      },
    ],
  },
  explore: {
    objective: [
      "계속 만들 수 있는 주제와 수익화 가설 하나 찾기",
      "Find a repeatable topic and one earning hypothesis",
      "続けられるテーマと収益化の仮説を一つ見つける",
    ],
    steps: [
      [
        "자주 쓰는 물건, 잘 설명하는 일, 반복하는 취미에서 소재를 하나씩 적어요. 오늘 촬영할 수 있고 직접 경험한 말이 나오는 소재부터 골라요.",
        "List an everyday object, a task you can explain, and a hobby. Start with what you can film today and discuss firsthand.",
        "日用品・説明できること・趣味から一つずつ書き、今日撮れて実体験を話せるものを選びます。",
      ],
      [
        "세 소재를 한꺼번에 운영하지 말고 첫 소재로 한 편을 완성해요. 제작 시간, 다음 질문이 떠오르는지, 실제로 받은 질문을 기록해요.",
        "Finish one video before running three topics. Record production time, follow-up ideas, and actual viewer questions.",
        "三つを同時運用せず、まず1本完成。時間・次の案・実際の質問を記録します。",
      ],
      [
        "제품 선택 질문이 많으면 제휴, 연속 설명에 관심이 있으면 시리즈, 구체적인 도움 요청이 오면 상품·상담 가능성을 검토해요. 첫 영상 하나의 조회수만으로 방향을 확정하지 않아요.",
        "Product-choice questions suggest affiliate content; follow-up interest suggests a series; requests for help suggest an offer. One video’s views are not enough to settle the choice.",
        "商品選びの質問なら紹介、続きへの関心ならシリーズ、助けの依頼なら商品や相談を検討。1本の再生数だけでは決めません。",
      ],
    ],
    closing: [
      "다음에는 어떤 부분을 더 자세히 보여드릴까요? 궁금한 점 하나를 남겨주세요.",
      "What should I show in more detail next? Leave one question.",
      "次はどこを詳しく見たいですか？質問を一つ教えてください。",
    ],
    signals: [
      {
        signal: [
          "무엇을 찍을지 계속 고민만 해요",
          "Still choosing what to film",
          "何を撮るか迷い続けている",
        ],
        action: [
          "새 주제 검색을 멈추고 오늘 실제로 한 일을 소재로 잡아요. 친구 한 명에게 설명하듯 한 번 녹음하고 필요한 장면을 붙여요.",
          "Use something you actually did today. Record an explanation for a friend and add the necessary scenes.",
          "今日実際にしたことを素材にし、友人に説明するように録音して必要な場面を加えます。",
        ],
      },
      {
        signal: [
          "만들기는 했는데 반응이 거의 없어요",
          "Finished a video with little response",
          "作ったが反応がほとんどない",
        ],
        action: [
          "다음 편은 같은 소재의 더 구체적인 질문으로 만들어요. 누구를 위한 영상인지 첫 문장에 넣고 제작 시간을 함께 비교해요.",
          "Answer a more specific question on the same topic. Name the viewer in the opening and compare production effort too.",
          "同じ素材の具体的な質問を次に扱い、冒頭で対象を示して制作時間も比べます。",
        ],
      },
      {
        signal: [
          "질문이 생기고 다음 편도 만들 수 있어요",
          "Questions arrive and you can make more",
          "質問が来て次も作れそう",
        ],
        action: [
          "같은 주제의 후속 질문 3개를 적고 가장 많이 나온 질문부터 제작해요. 그 질문이 제품 선택인지 지식 탐색인지 보고 수익화 가설을 좁혀요.",
          "List three follow-ups and start with the most common. Use whether it concerns buying or learning to narrow your earning hypothesis.",
          "次の質問を三つ書き、多いものから制作。商品選びか学びかを見て収益化の仮説を絞ります。",
        ],
      },
    ],
  },
};
