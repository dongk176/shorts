"use client";
import { useI18n } from "@/lib/i18n/provider";
import { textFor } from "@/lib/shorts-guides/catalog";
import { personalizedStrategy } from "./personalized-strategy";
import type { Answers } from "./monetization-model";
import s from "./monetization.module.css";
export function StrategyDetails({
  answers,
  hidePriority = false,
}: {
  answers: Answers;
  hidePriority?: boolean;
}) {
  const { locale } = useI18n();
  const p = personalizedStrategy(answers, locale);
  const l = (ko: string, en: string, ja: string) =>
    textFor([ko, en, ja], locale);
  return (
    <div className={s.strategyDetails}>
      {!hidePriority && (
        <section className={s.priorityCard}>
          <span className={s.eyebrow}>
            {l(
              "답변에서 찾은 지금의 우선순위",
              "Your priority, based on your answers",
              "回答から考えた、今の優先順位",
            )}
          </span>
          <h3>
            {l("먼저 이것부터 해보세요", "Start with this", "まずはここから")}
          </h3>
          <p>{p.priority}</p>
          <div className={s.profileNote}>{p.profile}</div>
        </section>
      )}
      <section className={s.resultBlock}>
        <span className={s.stepLabel}>
          {l(
            "지금 막히는 부분 해결하기",
            "Work on your sticking point",
            "今の悩みを解消する",
          )}
        </span>
        <h3>{p.focus.title}</h3>
        <p>{p.focus.action}</p>
        <p className={s.strategyMeasure}>
          <strong>{l("확인할 변화", "Look for", "確かめる変化")}</strong>{" "}
          {p.focus.measure}
        </p>
      </section>
      <section className={s.resultBlock}>
        <h3>
          {l(
            "첫 영상, 이렇게 구성해보세요",
            "Three video outlines to try",
            "最初の動画、こんな構成で",
          )}
        </h3>
        <p>
          {l(
            "실제로 경험한 내용으로 바꿔 쓰는 기획 초안이에요. 촬영하지 않은 결과나 수치는 넣지 마세요.",
            "Adapt these outlines to your real experience. Don’t add outcomes or numbers you haven’t observed.",
            "実際の経験に合わせて使う企画案です。確認していない結果や数字は入れないでください。",
          )}
        </p>
        <div className={s.scriptCards}>
          {p.scripts.map((script) => (
            <details key={script.number}>
              <summary>
                <span>0{script.number}</span>
                {script.hook}
              </summary>
              <div>
                <p>{script.body}</p>
                <dl>
                  <dt>{l("보여줄 장면", "Scenes", "見せる場面")}</dt>
                  <dd>{script.shot}</dd>
                  <dt>{l("마지막 안내", "Closing", "最後の案内")}</dt>
                  <dd>{script.ending}</dd>
                </dl>
              </div>
            </details>
          ))}
        </div>
      </section>
      <section className={s.resultBlock}>
        <span className={s.stepLabel}>EASYCUT WORKFLOW</span>
        <h3>
          {l(
            "이지컷으로 실행하는 순서",
            "Your EasyCut workflow",
            "EasyCutで進める手順",
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
      </section>
      <div className={s.strategyTips}>
        <section>
          <h3>
            {l(
              "내 시간에 맞춘 팁",
              "A tip for your schedule",
              "使える時間に合わせたコツ",
            )}
          </h3>
          <p>{p.timeTip}</p>
        </section>
        <section>
          <h3>
            {l("지금은 미뤄도 괜찮아요", "This can wait", "今は後回しで大丈夫")}
          </h3>
          <p>{p.skip}</p>
        </section>
      </div>
      <section className={s.resultBlock}>
        <h3>
          {l(
            "내 상황에서 궁금할 질문",
            "Questions for your situation",
            "今の状況で気になること",
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
