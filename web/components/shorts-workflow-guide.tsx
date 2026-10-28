import type { SiteLocale } from "@/lib/i18n/config";

const copy = {
  ko: {
    title: "목적에 맞는 쇼츠 제작 방법",
    intro: "아래는 제작 과정을 설명하기 위한 예시입니다. 실제 생성 결과와 조회수를 보장하는 사례는 아닙니다.",
    workflows: [
      ["팟캐스트를 쇼츠로", "질문 하나에 대한 답변을 중심으로 후보를 고르세요. 앞뒤 맥락 없이도 이해되는지 확인하고, 화자가 바뀌는 지점과 고유명사 자막을 검토합니다."],
      ["강의·튜토리얼을 짧게", "하나의 문제와 해결 방법을 담은 구간을 선택하세요. 설명에 필요한 화면이 세로 크롭에서 잘리지 않는지 보고, 빠진 전제는 제목이나 자막에 보완합니다."],
      ["리뷰·인터뷰 하이라이트", "결론만 자르기보다 이유나 시연이 함께 있는 구간을 고르세요. 원래 발언의 의미를 유지하고, 제품명과 숫자 자막을 원본과 대조합니다."],
    ],
    exampleTitle: "제작 예시: 인터뷰의 한 답변을 짧은 영상으로",
    example: "이용 권한이 있는 인터뷰 링크를 입력하고 AI가 제안한 후보를 검토합니다. 질문의 핵심이 드러나는 제목을 붙인 뒤, 9:16 화면에서 얼굴과 필요한 자료가 보이는지 확인합니다. 잘못 인식된 자막을 수정하고 내려받은 파일을 처음부터 끝까지 재생해 보세요.",
    chooseTitle: "AI 자동 편집, 수동 편집, 랭킹 쇼츠 중 무엇을 고를까요?",
    choices: [
      ["AI 하이라이트", "긴 영상에서 후보 구간을 먼저 찾고 싶을 때 적합합니다. 선택된 장면과 자막은 게시 전에 직접 검토하세요."],
      ["수동 편집", "장면마다 정교한 연출이나 복잡한 합성이 필요하다면 수동 편집 도구를 함께 쓰는 편이 적합합니다."],
      ["랭킹 쇼츠", "여러 영상의 장면을 직접 골라 순위별로 엮고 싶을 때 사용합니다. AI 하이라이트 제작과는 별도의 작업 흐름입니다."],
    ],
    checkTitle: "게시 전 확인할 것",
    checks: ["영상·음원·이미지를 사용할 권한이 있는지 확인하세요.", "이름, 수치, 자막과 편집된 발언의 맥락을 원본과 대조하세요.", "휴대전화에서 글자 크기와 화면 잘림을 확인하세요.", "게시할 플랫폼의 최신 업로드 조건을 확인하고 최종 파일을 재생하세요."],
  },
  en: {
    title: "Choose a workflow for your next Short",
    intro: "These are illustrative workflows, not customer results or promises of views.",
    workflows: [
      ["Turn a podcast into Shorts", "Start with one answer to one question. Choose a highlight that makes sense without the full episode, then check speaker changes and captions for names. Keep enough context for a new viewer to follow the point."],
      ["Repurpose a tutorial or lecture", "Choose a segment with one problem and one useful solution. Check that a vertical crop keeps the demonstration visible. Add essential context to the title or captions instead of leaving viewers to guess the missing steps."],
      ["Clip a review or interview", "Keep the explanation or demonstration alongside the conclusion. Compare names, numbers and product terms with the source, and make sure the shorter edit preserves what the speaker meant."],
    ],
    exampleTitle: "Example workflow: one interview answer, one short clip",
    example: "Paste a public interview link you have permission to use and review the AI highlight candidates. Write a title that captures the question being answered. In a 9:16 layout, check the speaker’s face and any supporting visuals. Correct the captions, download the clip and watch the whole file before uploading it.",
    chooseTitle: "AI clipping, manual editing or Ranking Shorts?",
    choices: [
      ["AI highlight clipping", "Use it to find candidate moments in a long video. You still choose which moments to keep and review captions before publishing."],
      ["Manual video editing", "Use a manual editor when you need detailed scene-by-scene direction, complex compositing or changes beyond the available templates."],
      ["Ranking Shorts", "Choose scenes from several videos and arrange them in a ranking. This is a separate workflow from automatic AI highlight selection."],
    ],
    checkTitle: "Before you publish",
    checks: ["Confirm permission to use the source footage, music and images.", "Check names, numbers, captions and the meaning of edited statements against the source.", "Preview text size and cropping on a phone.", "Check the destination platform’s current upload requirements and play the final file."],
  },
  ja: {
    title: "目的に合ったAI切り抜き・ショート動画の作り方",
    intro: "以下は制作手順を説明するための例です。利用者の実績や再生回数を保証するものではありません。",
    workflows: [
      ["ポッドキャストから切り抜く", "一つの質問に対する答えを中心に候補を選びます。番組全体を知らなくても意味が伝わるか確認し、話者の切り替わりや人名の字幕を見直しましょう。"],
      ["講義・解説動画を短くする", "一つの課題と解決方法が収まる場面を選びます。縦画面へのトリミングで実演や資料が切れていないか確認し、必要な前提はタイトルや字幕で補います。"],
      ["レビュー・インタビューを編集する", "結論だけでなく理由や実演も含めると、初めて見る人に伝わりやすくなります。商品名や数字を原動画と照合し、発言の意味が変わらないように整えます。"],
    ],
    exampleTitle: "制作例：インタビューの一つの回答をショート動画に",
    example: "利用権限のある公開インタビューのリンクを入力し、AIが提案した候補を確認します。質問の要点が分かるタイトルを付け、9:16の画面で顔や必要な資料が見えるか確認してください。字幕の誤りを直し、ダウンロードした動画を最初から最後まで再生してから投稿します。",
    chooseTitle: "AI自動編集・手動編集・ランキングショートの選び方",
    choices: [
      ["AIハイライト抽出", "長い動画から候補の場面を探したいときに向いています。採用する場面と字幕は、公開前に自分で確認してください。"],
      ["手動の動画編集", "場面ごとの細かい演出や複雑な合成、テンプレートの範囲を超える調整が必要な場合は、手動編集ツールの併用が適しています。"],
      ["ランキングショート", "複数の動画からシーンを選び、順位を付けてまとめるための機能です。AIによる自動ハイライト抽出とは別の制作手順になります。"],
    ],
    checkTitle: "投稿前のチェックリスト",
    checks: ["映像・音楽・画像の利用権限を確認します。", "人名、数字、字幕、編集した発言の意味を原動画と照合します。", "スマートフォンで文字の大きさと画面の切れ方を確認します。", "投稿先の最新のアップロード条件を確認し、完成ファイルを再生します。"],
  },
};

export function ShortsWorkflowGuide({ locale }: { locale: SiteLocale }) {
  const text = copy[locale];
  return <section aria-labelledby="workflow-guide-title" className="mt-12 space-y-8 rounded-3xl border border-white/10 bg-white/[.025] p-6 sm:p-10">
    <div><h2 id="workflow-guide-title" className="text-2xl font-bold text-white">{text.title}</h2><p className="mt-3 text-sm leading-7 text-neutral-400">{text.intro}</p></div>
    <div className="grid gap-6 md:grid-cols-3">{text.workflows.map(([title, body]) => <div key={title}><h3 className="font-bold text-[#ffb4a8]">{title}</h3><p className="mt-3 text-sm leading-7 text-neutral-300">{body}</p></div>)}</div>
    <div><h3 className="text-lg font-bold text-white">{text.exampleTitle}</h3><p className="mt-3 text-sm leading-7 text-neutral-300">{text.example}</p></div>
    <div><h3 className="text-lg font-bold text-white">{text.chooseTitle}</h3><dl className="mt-4 space-y-4">{text.choices.map(([title, body]) => <div key={title}><dt className="font-semibold text-neutral-100">{title}</dt><dd className="mt-1 text-sm leading-7 text-neutral-300">{body}</dd></div>)}</dl></div>
    <div><h3 className="text-lg font-bold text-white">{text.checkTitle}</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-7 text-neutral-300">{text.checks.map(item => <li key={item}>{item}</li>)}</ul></div>
  </section>;
}
