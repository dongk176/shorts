import type { SiteLocale } from "@/lib/i18n/config";
import type { UserOccupation } from "@/lib/user-onboarding";

export type HeroAudience = "creator" | "side_hustle";
export type HeroHeadline = readonly [string, string];
export const HERO_ROTATION_INTERVAL_MS = 5_000;

export function heroAudienceForOccupation(occupation: UserOccupation | null): HeroAudience | null {
  switch (occupation) {
    case "creator":
    case "marketing":
    case "brand":
    case "video_production":
      return "creator";
    case "education":
    case "employee_freelancer":
      return "side_hustle";
    default:
      return null;
  }
}

export const heroHeadlines = {
  "ko": {
    "creator": [
      [
        "AI에 영상 하나 줬더니,",
        "쇼츠가 쏟아졌다"
      ],
      [
        "쇼츠 하나 만드는데",
        "사람까지 써야 해요?"
      ],
      [
        "쇼츠 하나 만들자고",
        "오늘도 야근하세요?"
      ],
      [
        "편집자 구인공고,",
        "이제 내리세요"
      ],
      [
        "그 편집비,",
        "아직도 내고 계세요?"
      ],
      [
        "한 번 찍었으면,",
        "AI로 뽕 뽑으세요"
      ],
      [
        "영상은 쌓이는데,",
        "쇼츠는 왜 안 올라와요?"
      ],
      [
        "편집 기다리다가",
        "트렌드 다 지나가겠어요"
      ],
      [
        "AI는 준비됐는데,",
        "아직도 편집자 답장 기다려요?"
      ],
      [
        "쇼츠는 짧은데,",
        "제작 과정은 왜 이렇게 길죠?"
      ],
      [
        "잘 찍어놓고 왜 묵혀요?",
        "AI로 쇼츠까지 써먹으세요"
      ],
      [
        "롱폼 하나 올리고 끝?",
        "AI로 쇼츠도 챙기세요"
      ],
      [
        "편집자 일정 맞추다가,",
        "업로드 일정 또 밀렸죠?"
      ],
      [
        "기획자가 왜 자르고 있어요?",
        "편집은 AI한테 넘기세요"
      ],
      [
        "팀원이 부족한가요?",
        "AI는 써보셨고요?"
      ],
      [
        "좋은 장면 찍어놓고,",
        "긴 영상 속에 숨겨두게요?"
      ],
      [
        "업로드보다 수정 요청이 많죠?",
        "AI로 직접 뽑아보세요"
      ],
      [
        "쇼츠 하나 뽑는데,",
        "견적부터 받아야 해요?"
      ],
      [
        "AI는 쇼츠 뽑으라고 있는데,",
        "아직도 자막만 시키세요?"
      ],
      [
        "계속 편집할 건가요,",
        "이제 올릴 건가요?"
      ]
    ],
    "side_hustle": [
      [
        "회사에선 내가 일하고,",
        "퇴근 후엔 AI가 일하고"
      ],
      [
        "부업까지 몸으로 뛰게요?",
        "쇼츠 편집은 AI 시키세요"
      ],
      [
        "월급만 기다리기엔,",
        "AI가 너무 아깝잖아요"
      ],
      [
        "부업은 하고 싶은데,",
        "편집까지 배우긴 싫잖아요"
      ],
      [
        "부업 시작한다고,",
        "편집자까지 될 필요 있나요?"
      ],
      [
        "본업도 벅찬데,",
        "부업 편집까지 직접 하게요?"
      ],
      [
        "편집 배우다 올해 다 갑니다",
        "AI로 쇼츠부터 올리세요"
      ],
      [
        "뭘 만들지 고민만 하게요?",
        "실시간 인기부터 보세요"
      ],
      [
        "남들은 뭘로 조회수 뽑냐고요?",
        "실시간 인기 보면 나오죠"
      ],
      [
        "실시간 인기에서 소재 찾고,",
        "AI로 내 쇼츠도 올려봐요"
      ],
      [
        "퇴근하면 눕고 싶죠?",
        "쇼츠 편집은 AI한테 맡겨요"
      ],
      [
        "부업하려고 켠 유튜브,",
        "오늘도 구경만 하다 끄게요?"
      ],
      [
        "부업 강의는 몇 번째예요?",
        "AI로 한 편부터 올려봐요"
      ],
      [
        "시작도 전에 장비부터 사게요?",
        "있는 영상에 AI부터 써봐요"
      ],
      [
        "부업도 재능 있어야 하냐고요?",
        "일단 AI부터 써보세요"
      ],
      [
        "뭐가 뜨는지 감으로 찍게요?",
        "실시간 인기부터 확인하세요"
      ],
      [
        "부업 계획만 벌써 몇 달째죠?",
        "오늘은 AI로 하나 만들어봐요"
      ],
      [
        "소재 찾다가 잘 시간이라고요?",
        "실시간 인기에 모아뒀어요"
      ],
      [
        "주말까지 편집만 하게요?",
        "AI 시키고 좀 쉬세요"
      ],
      [
        "부업은 맨날 내일부터,",
        "AI로 오늘 하나만 해봐요"
      ]
    ]
  },
  "en": {
    "creator": [
      [
        "Gave AI one video,",
        "got a whole batch of Shorts"
      ],
      [
        "A whole person",
        "just to edit one Short?"
      ],
      [
        "Working late again",
        "over one little Short?"
      ],
      [
        "That editor job listing?",
        "Time to take it down"
      ],
      [
        "That editing bill,",
        "still paying it?"
      ],
      [
        "You filmed it once,",
        "let AI get more out of it"
      ],
      [
        "Videos piling up,",
        "but no new Shorts?"
      ],
      [
        "By the time the edit lands,",
        "the trend will be over"
      ],
      [
        "AI is ready to go,",
        "still waiting on your editor?"
      ],
      [
        "Short video,",
        "why the long production?"
      ],
      [
        "Great footage gathering dust?",
        "Let AI turn it into Shorts"
      ],
      [
        "One long video and done?",
        "Get some AI Shorts out of it"
      ],
      [
        "Waiting on your editor,",
        "pushing back another upload?"
      ],
      [
        "You do the planning,",
        "why are you cutting clips too?"
      ],
      [
        "Short on teammates?",
        "Have you tried AI yet?"
      ],
      [
        "You shot a great moment,",
        "why bury it in a long video?"
      ],
      [
        "More revisions than uploads?",
        "Make your own with AI"
      ],
      [
        "Need a quote",
        "just to make one Short?"
      ],
      [
        "AI can make your Shorts,",
        "why stop at captions?"
      ],
      [
        "Still editing,",
        "or ready to hit upload?"
      ]
    ],
    "side_hustle": [
      [
        "I work the day job,",
        "AI takes the evening shift"
      ],
      [
        "Another job after work?",
        "Let AI edit your Shorts"
      ],
      [
        "Just waiting for payday?",
        "Put that AI to work"
      ],
      [
        "Want a side hustle,",
        "without learning to edit?"
      ],
      [
        "Starting a side hustle,",
        "not an editing career, right?"
      ],
      [
        "Your day job is enough,",
        "why edit your side hustle too?"
      ],
      [
        "You could learn editing all year,",
        "or post your first AI Short"
      ],
      [
        "Still wondering what to make?",
        "Start with Trending Now"
      ],
      [
        "What gets everyone those views?",
        "Trending Now has the clues"
      ],
      [
        "Find ideas in Trending Now,",
        "make your own Shorts with AI"
      ],
      [
        "Just want to crash after work?",
        "Leave the Shorts editing to AI"
      ],
      [
        "Opened YouTube for your hustle,",
        "still just watching?"
      ],
      [
        "Another side hustle course?",
        "Try posting one AI Short"
      ],
      [
        "Buying gear before you start?",
        "Try AI on videos you have"
      ],
      [
        "Think you need a special talent?",
        "Give AI a try first"
      ],
      [
        "Guessing what is trending?",
        "Check Trending Now first"
      ],
      [
        "Planning that hustle for months?",
        "Make one with AI today"
      ],
      [
        "Bedtime already, still no idea?",
        "Try Trending Now"
      ],
      [
        "Editing through the weekend?",
        "Let AI work, take a break"
      ],
      [
        "Starting tomorrow, again?",
        "Make one AI Short today"
      ]
    ]
  },
  "ja": {
    "creator": [
      [
        "AIに動画を1本渡したら、",
        "ショートが次々できた"
      ],
      [
        "ショート1本のために、",
        "人まで雇うんですか？"
      ],
      [
        "ショート1本のために、",
        "今日も残業ですか？"
      ],
      [
        "その編集者の求人、",
        "そろそろ下げませんか？"
      ],
      [
        "その編集代、",
        "まだ払ってるんですか？"
      ],
      [
        "せっかく撮ったなら、",
        "AIでとことん使い倒そう"
      ],
      [
        "動画はたまるのに、",
        "ショートは増えない？"
      ],
      [
        "編集を待っている間に、",
        "トレンド終わっちゃいますよ"
      ],
      [
        "AIは準備できてますけど、",
        "まだ編集者の返信待ち？"
      ],
      [
        "動画は短いのに、",
        "制作はなんでそんなに長いの？"
      ],
      [
        "いい動画、眠らせてない？",
        "AIでショートにも使おう"
      ],
      [
        "長い動画を投稿して終わり？",
        "AIでショートも作りましょう"
      ],
      [
        "編集者の予定に合わせて、",
        "また投稿が延期ですか？"
      ],
      [
        "企画担当なのに、",
        "カット編集までやるんですか？"
      ],
      [
        "人手が足りない？",
        "AIはもう試しましたか？"
      ],
      [
        "せっかくのいいシーン、",
        "長い動画に埋もれたまま？"
      ],
      [
        "投稿より修正依頼が多い？",
        "AIで自分で作ってみよう"
      ],
      [
        "ショートを1本作るのに、",
        "まずは見積もりからですか？"
      ],
      [
        "AIはショートも作れるのに、",
        "字幕だけで終わりですか？"
      ],
      [
        "まだ編集しますか？",
        "そろそろ投稿しませんか？"
      ]
    ],
    "side_hustle": [
      [
        "会社では自分が働いて、",
        "退勤後はAIが働く"
      ],
      [
        "副業まで自力で頑張るの？",
        "ショートの編集はAIに任せよう"
      ],
      [
        "給料日を待つだけじゃ、",
        "AIがもったいない"
      ],
      [
        "副業はしたいけど、",
        "編集まで覚えたくないですよね"
      ],
      [
        "副業を始めるために、",
        "編集者にまでなる必要ある？"
      ],
      [
        "本業だけでも大変なのに、",
        "副業の編集まで自分でやるの？"
      ],
      [
        "編集を覚えてたら年が明ける",
        "AIでまず1本投稿しよう"
      ],
      [
        "何を作るか、まだ悩んでる？",
        "まずはリアルタイム急上昇へ"
      ],
      [
        "みんな何で再生を伸ばしてる？",
        "リアルタイム急上昇で見てみよう"
      ],
      [
        "リアルタイム急上昇でネタ探し",
        "AIで自分のショートも投稿しよう"
      ],
      [
        "退勤したら横になりたい？",
        "ショートの編集はAIに任せよう"
      ],
      [
        "副業のために開いたYouTube、",
        "今日も見るだけで終わり？"
      ],
      [
        "副業の講座、これで何回目？",
        "AIでまず1本投稿してみよう"
      ],
      [
        "始める前に機材を買うの？",
        "手持ちの動画でAIを試そう"
      ],
      [
        "副業にも才能が必要？",
        "まずはAIを使ってみよう"
      ],
      [
        "何が流行るか、勘で決めるの？",
        "まずはリアルタイム急上昇を確認"
      ],
      [
        "副業の計画、もう何か月目？",
        "今日はAIで1本作ってみよう"
      ],
      [
        "ネタ探しだけでもう寝る時間？",
        "リアルタイム急上昇に集めました"
      ],
      [
        "週末まで編集するんですか？",
        "AIに任せて少し休もう"
      ],
      [
        "副業はいつも明日から？",
        "今日はAIで1本だけ作ろう"
      ]
    ]
  }
} as const satisfies Record<SiteLocale, Record<HeroAudience, readonly HeroHeadline[]>>;
