import Link from "next/link";

const steps = [
  {
    number: "01",
    title: "유튜브 링크 입력",
    description: "직접 제작했거나 이용 권한을 가진 공개 YouTube 영상의 URL을 붙여 넣습니다.",
  },
  {
    number: "02",
    title: "AI 하이라이트 분석",
    description: "쇼츠 AI가 영상의 맥락과 몰입 구간을 분석해 30~60초 후보를 찾습니다.",
  },
  {
    number: "03",
    title: "편집하고 다운로드",
    description: "후킹 제목, 자막, 화면 비율과 템플릿을 확인하고 완성된 쇼츠를 내려받습니다.",
  },
];

const features = [
  ["AI 하이라이트 추출", "긴 영상을 처음부터 다시 보지 않아도 핵심 장면을 자동으로 선별합니다."],
  ["30~60초 쇼츠 제작", "YouTube Shorts, 릴스, 틱톡에 활용하기 좋은 짧은 클립으로 만듭니다."],
  ["후킹 제목·자동 자막", "영상 맥락에 맞는 제목과 자막 초안을 만들고 결과 화면에서 수정할 수 있습니다."],
  ["5가지 화면 비율", "16:9, 5:4, 1:1, 4:5, 9:16 비율 중 콘텐츠에 맞는 화면을 선택합니다."],
  ["4가지 쇼츠 템플릿", "다크 레드, 화이트 옐로, 다크 미니멀, 페이퍼 스타일을 제공합니다."],
  ["8개 제목 언어", "한국어·영어·일본어·중국어·스페인어·프랑스어·독일어·포르투갈어 제목을 지원합니다."],
] as const;

const useCases = [
  ["인터뷰·대담", "핵심 답변과 인상적인 발언을 짧은 쇼츠로 재활용하세요."],
  ["강의·교육", "긴 설명에서 바로 써볼 수 있는 지식과 팁을 짧게 전달하세요."],
  ["팟캐스트", "대화의 흐름을 살린 하이라이트로 새로운 시청자를 만나세요."],
  ["정보 콘텐츠", "뉴스, 리뷰, 노하우 영상의 핵심 내용을 여러 개의 숏폼으로 확장하세요."],
] as const;

export function AiShortsGuideContent() {
  return (
    <>
      <section id="how-it-works" aria-labelledby="how-it-works-title" className="scroll-mt-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#ff9b8d]">YouTube to Shorts</p>
          <h2 id="how-it-works-title" className="mt-3 text-2xl font-black tracking-[-.035em] text-white sm:text-3xl">유튜브 영상을 AI 쇼츠로 만드는 방법</h2>
          <p className="mt-4 text-sm leading-7 text-neutral-400">복잡한 영상 편집 타임라인 없이 링크 입력부터 쇼츠 완성까지 세 단계로 진행합니다.</p>
        </div>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <li key={step.number} className="rounded-2xl border border-white/10 bg-black/15 p-6">
              <span className="text-xs font-black tracking-[.16em] text-violet-300">{step.number}</span>
              <h3 className="mt-3 text-lg font-extrabold text-white">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-neutral-400">{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="templates" aria-labelledby="features-title" className="scroll-mt-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-extrabold uppercase tracking-[.18em] text-violet-300">AI Shorts Maker</p>
          <h2 id="features-title" className="mt-3 text-2xl font-black tracking-[-.035em] text-white sm:text-3xl">쇼츠 자동 제작에 필요한 기능을 한곳에</h2>
          <p className="mt-4 text-sm leading-7 text-neutral-400">이지컷은 하이라이트 탐색부터 제목, 자막, 비율, 템플릿과 다운로드까지 한 흐름으로 연결합니다.</p>
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(([title, description]) => (
            <article key={title} className="rounded-2xl border border-white/10 bg-white/[.025] p-5">
              <h3 className="font-extrabold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-neutral-400">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="use-cases-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#ff9b8d]">Use cases</p>
            <h2 id="use-cases-title" className="mt-3 text-2xl font-black tracking-[-.035em] text-white sm:text-3xl">하나의 롱폼을 여러 숏폼 콘텐츠로</h2>
          </div>
          <Link href="/pricing" className="text-sm font-extrabold text-[#ff9b8d] hover:text-white">요금제 확인하기 →</Link>
        </div>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {useCases.map(([title, description]) => (
            <article key={title} className="rounded-2xl bg-black/15 p-5">
              <h3 className="font-extrabold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-neutral-400">{description}</p>
            </article>
          ))}
        </div>
      </section>

    </>
  );
}
