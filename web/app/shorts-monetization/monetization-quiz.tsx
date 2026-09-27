"use client";

import { useI18n } from "@/lib/i18n/provider";
import { monetizationTranslator } from "./monetization-copy";
import Link from "@/lib/i18n/navigation";
import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "@/lib/browser-clipboard";
import {
  answerLabel,
  createPlan,
  isComplete,
  getQuestions,
  type Answers,
} from "./monetization-model";
import Image from "next/image";
import { QUIZ_STORAGE_KEY, readQuizDraft } from "./quiz-storage";
import { guideCatalog, textFor } from "@/lib/shorts-guides/catalog";
import {
  getStrategyQuestions,
  personalizedStrategy,
  personalizedPlanText,
} from "./personalized-strategy";
import { StrategyDetails } from "./strategy-details";
import { useGuideRecommendation } from "./guide-recommendation";
import { trackGuideEvent, newGuideSurvey } from "@/lib/shorts-analytics/client";
import { Icon } from "./icons";
import s from "./monetization.module.css";

function track(event: string, values: Record<string, string | number> = {}) {
  if (process.env.NODE_ENV !== "production") return;
  window.gtag?.("event", event, { guide_version: "20260927", ...values });
}

export function MonetizationQuiz() {
  const { locale } = useI18n();
  const t = monetizationTranslator(locale);
  const [answers, setAnswers] = useState<Answers>({});
  const questions = [
    ...getQuestions(locale),
    ...getStrategyQuestions(answers, locale),
  ];
  const l = (ko: string, en: string, ja: string) =>
    textFor([ko, en, ja], locale);
  const { setRecommended, active, setActive, setResume } =
    useGuideRecommendation();
  const [hydrated, setHydrated] = useState(false);
  const [editMenu, setEditMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [canSave, setCanSave] = useState(true);
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [showCopyFallback, setShowCopyFallback] = useState(false);
  const [inView, setInView] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const started = useRef(false);
  const copyAttempt = useRef(0);
  const question = questions[step];
  const selected = answers[question.key];
  const plan = finished ? createPlan(answers, locale) : null;
  const strategy = personalizedStrategy(answers, locale);
  const missingAnswer = questions.findIndex(
    (q) => !q.options.some((o) => o.value === answers[q.key]),
  );

  useEffect(() => {
    try {
      const draft = readQuizDraft(localStorage.getItem(QUIZ_STORAGE_KEY));
      if (draft) {
        setAnswers(draft.answers);
        setStep(draft.step);
        setFinished(draft.finished);
        setResume(
          draft.finished
            ? "result"
            : Object.keys(draft.answers).length
              ? "draft"
              : "new",
        );
        if (draft.finished)
          setRecommended(personalizedStrategy(draft.answers, locale).guide);
      }
    } catch {
      setCanSave(false);
    }
    setHydrated(true);
  }, [locale, setRecommended, setResume]);

  useEffect(() => {
    if (!hydrated) return;
    setResume(
      finished ? "result" : Object.keys(answers).length ? "draft" : "new",
    );
    try {
      if (Object.keys(answers).length)
        localStorage.setItem(
          QUIZ_STORAGE_KEY,
          JSON.stringify({
            version: 1,
            savedAt: Date.now(),
            answers,
            step,
            finished,
          }),
        );
      else localStorage.removeItem(QUIZ_STORAGE_KEY);
    } catch {
      setCanSave(false);
    }
  }, [answers, step, finished, hydrated, setResume]);

  useEffect(() => {
    if (active) {
      moved.current = true;
      title.current?.focus({ preventScroll: true });
    }
  }, [active]);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!moved.current) return;
    title.current?.focus({ preventScroll: true });
    const target =
      active && !finished
        ? root.current
        : title.current?.closest("#find-my-way");
    target?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [step, finished, active]);

  const viewRecorded = useRef("");
  useEffect(() => {
    if (!hydrated || !active || finished) {
      viewRecorded.current = "";
      return;
    }
    const viewKey = `${locale}:${step}`;
    if (viewRecorded.current === viewKey) return;
    viewRecorded.current = viewKey;
    trackGuideEvent({ name: "quiz_started", locale, answers });
    trackGuideEvent({
      name: "question_viewed",
      locale,
      question: question.key,
      answers,
    });
  }, [active, finished, hydrated, step, locale, answers, question.key]);

  function recordCompletion() {
    trackGuideEvent({
      name: "quiz_completed",
      locale,
      answers,
      guide: strategy.guide,
    });
  }

  function move(next: number) {
    moved.current = true;
    setStep(next);
    setCopyStatus("");
  }

  function restart() {
    newGuideSurvey();
    viewRecorded.current = "";
    copyAttempt.current += 1;
    moved.current = true;
    setFinished(false);
    setEditing(false);
    setEditMenu(false);
    setRecommended(undefined);
    setStep(0);
    setAnswers({});
    setShowCopyFallback(false);
    setCopyStatus("");
    started.current = false;
  }

  async function copyPlan() {
    const attempt = ++copyAttempt.current;
    try {
      await copyTextToClipboard(personalizedPlanText(answers, locale));
      if (attempt !== copyAttempt.current) return;
      setCopyStatus(t("계획을 복사했어요. 메모 앱에 붙여넣어 보세요."));
      setShowCopyFallback(false);
      trackGuideEvent({ name: "result_action", action: "copy_plan", locale });
      track("monetization_plan_copy", { route: plan?.route || "explore" });
    } catch {
      if (attempt !== copyAttempt.current) return;
      setCopyStatus(t("아래 계획을 길게 눌러 직접 복사해 주세요."));
      setShowCopyFallback(true);
    }
  }

  return (
    <>
      <div
        className={s.quizAnchor}
        ref={root}
        data-questionnaire={active && !finished}
      >
        {active && (
          <div className={s.quizUtility}>
            <button
              type="button"
              onClick={() => {
                if (!finished)
                  trackGuideEvent({
                    name: "quiz_exited",
                    locale,
                    question: question.key,
                    answers,
                  });
                setActive(false);
                window.scrollTo({ top: 0, behavior: "instant" });
              }}
            >
              {l("← 소개로 돌아가기", "← Back to overview", "← 紹介に戻る")}
            </button>
            <span>
              {canSave
                ? l(
                    "답변은 이 기기에 30일간 저장돼요",
                    "Saved on this device for 30 days",
                    "回答はこの端末に30日間保存されます",
                  )
                : l(
                    "이 브라우저에서는 자동 저장이 어려워요",
                    "Automatic saving is unavailable in this browser",
                    "このブラウザでは自動保存できません",
                  )}
            </span>
          </div>
        )}
        {active &&
          (!plan ? (
            <div className={s.quizLayout}>
              <form
                id="find-my-way"
                className={s.quizCard}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!selected) return;
                  track("monetization_question_complete", { step: step + 1 });
                  if (editing) {
                    if (missingAnswer >= 0) move(missingAnswer);
                    else {
                      moved.current = true;
                      recordCompletion();
                      setFinished(true);
                      setEditing(false);
                      setRecommended(strategy.guide);
                    }
                  } else if (step < questions.length - 1) move(step + 1);
                  else if (
                    isComplete(answers) &&
                    questions.every((q) =>
                      q.options.some((o) => o.value === answers[q.key]),
                    )
                  ) {
                    moved.current = true;
                    recordCompletion();
                    setFinished(true);
                    setRecommended(strategy.guide);
                    track("monetization_quiz_complete", {
                      route: createPlan(answers, locale).route,
                      time: answers.time || "unsure",
                    });
                  }
                }}
              >
                <div className={s.quizMeta}>
                  <span>{question.eyebrow}</span>
                  <span>
                    <b>{String(step + 1).padStart(2, "0")}</b> /{" "}
                    {String(questions.length).padStart(2, "0")}
                  </span>
                </div>
                <div
                  className={s.progress}
                  role="progressbar"
                  aria-valuemin={1}
                  aria-valuemax={questions.length}
                  aria-valuenow={step + 1}
                  aria-label={l(
                    `${questions.length}단계 중 ${step + 1}단계`,
                    `Step ${step + 1} of ${questions.length}`,
                    `全${questions.length}問のうち${step + 1}問目`,
                  )}
                >
                  {questions.map((q, index) => (
                    <span
                      key={q.key}
                      className={index <= step ? s.progressFilled : ""}
                    />
                  ))}
                </div>
                <div key={question.key} className={s.questionBody}>
                  <h2 ref={title} tabIndex={-1} id="quiz-question">
                    {question.title}
                  </h2>
                  <p id="quiz-description">{question.description}</p>
                  <fieldset
                    aria-labelledby="quiz-question"
                    aria-describedby="quiz-description"
                    className={`${s.options} ${question.key === "category" || question.key === "time" ? s.optionGrid : ""}`}
                  >
                    <legend className={s.srOnly}>{question.title}</legend>
                    {question.options.map((option) => (
                      <label
                        key={option.value}
                        className={`${s.option} ${selected === option.value ? s.selectedOption : ""}`}
                      >
                        <input
                          type="radio"
                          name={question.key}
                          value={option.value}
                          checked={selected === option.value}
                          onChange={() => {
                            if (!started.current) {
                              started.current = true;
                              track("monetization_quiz_start");
                            }
                            const nextAnswers = {
                              ...answers,
                              [question.key]: option.value,
                              ...(["goal", "category"].includes(question.key)
                                ? { readiness: undefined }
                                : {}),
                            };
                            trackGuideEvent({
                              name: "answer_selected",
                              locale,
                              question: question.key,
                              answer: option.value,
                              answers: nextAnswers,
                            });
                            setAnswers(nextAnswers);
                          }}
                        />
                        <span className={s.optionIcon}>
                          <Icon name={option.icon || "spark"} size={21} />
                        </span>
                        <span className={s.optionText}>
                          <strong>{option.label}</strong>
                          {option.detail ? (
                            <small>{option.detail}</small>
                          ) : null}
                        </span>
                        <span className={s.radioMark}>
                          {selected === option.value ? (
                            <Icon name="check" size={12} />
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                </div>
                <div className={s.quizActions}>
                  <button
                    type="button"
                    className={s.backButton}
                    disabled={step === 0}
                    onClick={() => move(step - 1)}
                  >
                    <Icon name="back" size={18} />
                    {t("이전")}
                  </button>
                  <button
                    type="submit"
                    className={s.nextButton}
                    disabled={!selected}
                  >
                    {editing
                      ? missingAnswer >= 0
                        ? l(
                            "관련 답변 확인하기",
                            "Review related answer",
                            "関連する回答を確認",
                          )
                        : l(
                            "변경한 답변으로 결과 보기",
                            "Update my plan",
                            "変更した回答で結果を見る",
                          )
                      : step === questions.length - 1
                        ? t("내 시작 계획 보기")
                        : t("다음으로")}
                    <Icon
                      name={step === questions.length - 1 ? "spark" : "arrow"}
                      size={18}
                    />
                  </button>
                </div>
                <p className={s.quizFootnote}>
                  {t(
                    "답변을 선택한 뒤 다음으로 이동하세요. 이전 답변은 수정할 수 있습니다.",
                  )}
                </p>
                <noscript>
                  {t(
                    "맞춤 설문은 JavaScript가 필요해요. 아래 수익화 가이드는 바로 읽을 수 있어요.",
                  )}
                </noscript>
              </form>
            </div>
          ) : (
            <div id="find-my-way" className={s.result}>
              <div className={s.resultTopline}>
                <span className={s.eyebrow}>{t("맞춤 수익화 계획")}</span>
                <span>
                  <Icon name="check" size={15} />
                  {t("내 답변에 맞춘 추천")}
                </span>
              </div>
              <div className={s.resultHeading}>
                <div>
                  <span className={s.resultBadge}>
                    <Icon name="compass" size={17} />
                    {plan.label}
                  </span>
                  <h2 ref={title} tabIndex={-1}>
                    {plan.title}
                  </h2>
                  <p>{plan.description}</p>
                </div>
              </div>
              <div className={s.answerChips}>
                <span>{answerLabel("category", answers.category, locale)}</span>
                <span>{plan.time.label}</span>
                <span>{answerLabel("stage", answers.stage, locale)}</span>
              </div>
              <div className={s.reason}>
                <Icon name="spark" size={20} />
                <p>{strategy.positioning}</p>
              </div>
              <section className={s.todayAction}>
                <span className={s.eyebrow}>
                  {l("오늘 할 일", "Your next step today", "今日やること")}
                </span>
                <p>{strategy.priority}</p>
                <small className={s.todayBudget}>
                  {l("오늘 작업 예시", "Example session", "今日の作業例")} ·{" "}
                  {strategy.todayMinutes}
                  {l("분", " min", "分")}
                </small>
                <ol className={s.todayTasks}>
                  {strategy.today.map((task, index) => (
                    <li key={task.title}>
                      <div>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{task.title}</strong>
                        <small>
                          {task.minutes}
                          {l("분", " min", "分")}
                        </small>
                      </div>
                      <p>{task.body}</p>
                      <div className={s.doneLine}>
                        <strong>
                          {l("완료 기준", "Done when you have", "完了の目安")}
                        </strong>
                        <span>{task.done}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              <div className={s.resultActions}>
                {plan.ready ? (
                  <Link
                    prefetch={false}
                    className={s.nextButton}
                    href="/"
                    onClick={() => {
                      trackGuideEvent({
                        name: "result_action",
                        action: "create_short",
                        locale,
                      });
                      track("monetization_create_click", { route: plan.route });
                    }}
                  >
                    {t("내 영상으로 쇼츠 만들기")}
                    <Icon name="arrow" size={18} />
                  </Link>
                ) : (
                  <a
                    className={s.nextButton}
                    href="#shooting-checklist"
                    onClick={() =>
                      trackGuideEvent({
                        name: "result_action",
                        action: "filming_checklist",
                        locale,
                      })
                    }
                  >
                    {t("첫 촬영 체크리스트 보기")}
                    <Icon name="arrow" size={18} />
                  </a>
                )}
                <button
                  type="button"
                  className={s.copyButton}
                  onClick={copyPlan}
                >
                  <Icon name="copy" size={17} />
                  {t("계획 복사하기")}
                </button>
              </div>
              <p role="status" className={s.copyStatus}>
                {copyStatus}
              </p>
              {showCopyFallback ? (
                <textarea
                  className={s.copyFallback}
                  aria-label={t("직접 복사할 나의 계획")}
                  readOnly
                  value={personalizedPlanText(answers, locale)}
                  onFocus={(event) => event.target.select()}
                />
              ) : null}
              <button
                type="button"
                className={s.editAnswersButton}
                aria-expanded={editMenu}
                onClick={() => setEditMenu(!editMenu)}
              >
                {l("답변 수정", "Edit answers", "回答を変える")}
              </button>
              {editMenu && (
                <div className={s.editAnswerGrid}>
                  {questions.map((q, index) => (
                    <button
                      type="button"
                      key={q.key}
                      onClick={() => {
                        moved.current = true;
                        copyAttempt.current += 1;
                        setCopyStatus("");
                        setShowCopyFallback(false);
                        setEditing(true);
                        setFinished(false);
                        setRecommended(undefined);
                        setStep(index);
                        setEditMenu(false);
                      }}
                    >
                      <small>{q.eyebrow}</small>
                      <strong>
                        {
                          q.options.find((o) => o.value === answers[q.key])
                            ?.label
                        }
                      </strong>
                    </button>
                  ))}
                </div>
              )}
              <StrategyDetails answers={answers} />
              <section className={s.workbookNext}>
                <span className={s.stepLabel}>
                  07 · {l("더 자세히 따라 해보기", "GO DEEPER", "さらに詳しく")}
                </span>
                <h3>
                  {l(
                    "더 자세한 내용은 실행북에 담았어요",
                    "Continue with the detailed workbook",
                    "詳しい内容は実践ブックで",
                  )}
                </h3>
                <p>{strategy.bookIntro}</p>
                <a
                  className={s.resultBook}
                  href="#guide-library"
                  onClick={() =>
                    trackGuideEvent({
                      name: "result_action",
                      action: "recommended_book",
                      locale,
                      guide: strategy.guide,
                    })
                  }
                >
                  <Image
                    src={`/shorts-guide-previews/${locale}/${strategy.guide}-cover.jpg?v=20260927-editorial-2`}
                    alt=""
                    width={84}
                    height={119}
                  />
                  <span>
                    <small>
                      {l(
                        "내 답변에 맞는 실행북 · 표지 미리보기",
                        "Your workbook · Cover preview",
                        "回答に合う実践ブック・表紙を見る",
                      )}
                    </small>
                    <strong>
                      {textFor(guideCatalog[strategy.guide].title, locale)}
                    </strong>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
              </section>
              <div className={s.resultFooter}>
                <span>
                  {t(
                    "실행 방향을 위한 제안이며 수입·제작량·승인을 보장하지 않아요.",
                  )}
                </span>
                <div>
                  <button type="button" onClick={restart}>
                    {t("처음부터 다시")}
                  </button>
                </div>
              </div>
            </div>
          ))}
      </div>
      <div
        className={`${s.mobileDock} ${inView || !active || !finished ? s.hiddenDock : ""}`}
        aria-hidden={inView || !active || !finished ? true : undefined}
      >
        <span>
          {finished ? t("나만의 시작 계획") : t("나에게 맞는 수익화 방법")}
          <small>
            {finished
              ? t("언제든 다시 확인하세요")
              : t("8가지 질문 · 로그인 없이")}
          </small>
        </span>
        <a
          href="#find-my-way"
          tabIndex={inView || !active || !finished ? -1 : 0}
        >
          {finished ? t("결과 보기") : t("방법 찾기")}
          <Icon name="arrow" size={17} />
        </a>
      </div>
    </>
  );
}
