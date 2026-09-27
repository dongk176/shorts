"use client";
import { useI18n } from "@/lib/i18n/provider";
import { textFor } from "@/lib/shorts-guides/catalog";
import { personalizedStrategy } from "./personalized-strategy";
import type { Answers } from "./monetization-model";
import s from "./monetization.module.css";
export function StrategyDetails({ answers }: { answers: Answers }) {
  const { locale } = useI18n();
  const p = personalizedStrategy(answers, locale);
  const l = (ko: string, en: string, ja: string) =>
    textFor([ko, en, ja], locale);
  const sections = [
    ["strategy-videos", l("영상 대본", "Scripts", "台本")],
    ["strategy-workflow", l("이지컷 활용", "EasyCut", "EasyCut")],
    ["strategy-revenue", l("수익화 연결", "Earning path", "収益化")],
    ["strategy-week", l("첫 주 일정", "Schedule", "予定")],
    ["strategy-review", l("개선 방법", "Review", "改善")],
    ["strategy-faq", "FAQ"],
  ];
  return (
    <div className={s.strategyDetails}>
      <nav
        className={s.strategyNav}
        aria-label={l(
          "내 실행 계획 목차",
          "Action plan contents",
          "実行プランの目次",
        )}
      >
        {sections.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
            <span aria-hidden="true">↓</span>
          </a>
        ))}
      </nav>
      <section id="strategy-videos" className={s.resultBlock}>
        <span className={s.stepLabel}>
          01 · {l("콘텐츠 기획", "CONTENT", "動画企画")}
        </span>
        <h3>
          {l(
            "이 세 편으로 시작해보세요",
            "Start with these three videos",
            "この3本から始めよう",
          )}
        </h3>
        <p>
          {l(
            "첫 번째 대본을 펼쳐뒀어요. 대괄호는 내 경험으로 채우고, 시간은 구성 예시로 활용하세요. 첫 주에는 한 편부터 완성해도 충분해요.",
            "The first script is open. Replace brackets with your experience; timings are an example structure. Start by finishing one video in your first week.",
            "最初の台本を開いています。角括弧は自分の経験で埋め、秒数は構成の目安に。最初の週は1本完成からで大丈夫です。",
          )}
        </p>
        <div className={s.scriptCards}>
          {p.scripts.map((script) => (
            <details key={script.number} open={script.number === 1}>
              <summary>
                <span>0{script.number}</span>
                {script.hook}
              </summary>
              <div>
                <ol className={s.scriptTimeline}>
                  {script.beats.map((b) => (
                    <li key={b.timing}>
                      <span>{b.timing}</span>
                      <div>
                        <strong>{b.label}</strong>
                        <p>{b.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className={s.shotNote}>
                  <strong>
                    {l(
                      "이 장면을 준비하세요",
                      "Prepare these shots",
                      "この場面を用意",
                    )}
                  </strong>
                  <p>{script.shot}</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>
      <section id="strategy-workflow" className={s.resultBlock}>
        <span className={s.stepLabel}>02 · EASYCUT</span>
        <h3>
          {l(
            "원본에서 게시까지, 이렇게 작업하세요",
            "From source footage to publishing",
            "元動画から公開まで、この順で",
          )}
        </h3>
        <ol className={s.workflowList}>
          {p.workflow.map((w) => (
            <li key={w.title}>
              <strong>{w.title}</strong>
              <p>{w.body}</p>
            </li>
          ))}
        </ol>
        {p.sourceNote && (
          <aside className={s.sourceNote}>
            <strong>
              {l(
                "참고한 원본에 관해서",
                "About the reference footage",
                "参考にした素材について",
              )}
            </strong>
            <p>{p.sourceNote}</p>
          </aside>
        )}
      </section>
      <section id="strategy-revenue" className={s.resultBlock}>
        <span className={s.stepLabel}>
          03 · {l("수익화 연결", "EARNING PATH", "収益化への流れ")}
        </span>
        <h3>
          {l(
            "영상 다음에 이 단계를 준비하세요",
            "Prepare the next step beyond the video",
            "動画の次に、この準備を",
          )}
        </h3>
        <ol className={s.numberedSteps}>
          {p.revenueSteps.map((step, i) => (
            <li key={i}>
              <span aria-hidden="true">{i + 1}</span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
        <a
          className={s.policyLink}
          href={`https://support.google.com/youtube/answer/${p.route === "ads" ? "72851" : "13748639"}?hl=${locale}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {l(
            "유튜브 공식 안내 확인",
            "Check YouTube’s official guidance",
            "YouTubeの公式案内を確認",
          )}{" "}
          ↗
        </a>
      </section>
      <section id="strategy-week" className={s.resultBlock}>
        <span className={s.stepLabel}>
          04 · {l("실행 일정", "SCHEDULE", "実行スケジュール")}
        </span>
        <h3>
          {l(
            "내 시간에 맞춰 나눈 첫 주 계획",
            "A first week that fits your time",
            "使える時間に合わせた最初の週",
          )}
        </h3>
        <p>{p.timeTip}</p>
        <div className={s.weekOutcome}>
          <small>
            {l("이번 주에 남길 것", "Your output for the week", "今週残すもの")}
          </small>
          <strong>{p.deliverable}</strong>
        </div>
        <ol className={s.detailedWeek}>
          {p.schedule.map((x) => (
            <li key={x.when}>
              <span>{x.when}</span>
              <div>
                <h4>{x.title}</h4>
                <p>{x.body}</p>
                <div className={s.doneLine}>
                  <strong>
                    {l("완료 기준", "Done when you have", "完了の目安")}
                  </strong>
                  <span>{x.output}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section id="strategy-review" className={s.resultBlock}>
        <span className={s.stepLabel}>
          05 · {l("게시 후 개선", "REVIEW", "公開後の改善")}
        </span>
        <h3>
          {l(
            "이런 반응이라면, 다음 편은 이렇게",
            "If you see this, change that next",
            "こんな反応なら、次はこう変える",
          )}
        </h3>
        <p>
          {l(
            "조회수만 보지 말고 영상 주제·공개일·제작 시간·실제 반응을 함께 적어요. 아래에서 지금 해당하는 한 가지를 골라 다음 편에 적용하세요.",
            "Log topic, release date, production time, and actual response alongside views. Choose one applicable action below for the next video.",
            "再生数と一緒にテーマ・公開日・制作時間・実際の反応を記録。今当てはまる一つを次に試しましょう。",
          )}
        </p>
        <div className={s.diagnosisList}>
          {p.review.map((x) => (
            <article key={x.signal}>
              <h4>{x.signal}</h4>
              <p>{x.action}</p>
            </article>
          ))}
        </div>
        <div className={s.focusPanel}>
          <span className={s.eyebrow}>
            {l("내가 선택한 고민", "Your selected obstacle", "選んだ悩み")}
          </span>
          <h4>{p.focus.title}</h4>
          <p>{p.focus.action}</p>
          <p className={s.strategyMeasure}>
            <strong>{l("기록할 것", "Track", "記録すること")}</strong>{" "}
            {p.focus.measure}
          </p>
          <p>{p.skip}</p>
        </div>
      </section>
      <section id="strategy-faq" className={s.resultBlock}>
        <span className={s.stepLabel}>06 · FAQ</span>
        <h3>
          {l(
            "내 상황에 맞는 자주 묻는 질문",
            "Answers for your situation",
            "自分の状況に合うよくある質問",
          )}
        </h3>
        <div className={s.faqList}>
          {p.faqs.map((f) => (
            <details key={f.q}>
              <summary>
                <h4>{f.q}</h4>
                <span className={s.faqPlus} aria-hidden="true" />
              </summary>
              <div>
                <p>{f.a}</p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
