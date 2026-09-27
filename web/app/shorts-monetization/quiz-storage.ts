import { getQuestions, isComplete, type Answers } from "./monetization-model";
import { getStrategyQuestions } from "./personalized-strategy";
export const QUIZ_STORAGE_KEY = "easycut:monetization-plan:v1";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
export function readQuizDraft(raw: string | null, now = Date.now()) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      typeof data.savedAt !== "number" ||
      now - data.savedAt > MAX_AGE ||
      data.savedAt > now ||
      !data.answers ||
      typeof data.answers !== "object"
    )
      return null;
    const answers: Answers = {};
    for (const q of getQuestions("ko")) {
      if (q.options.some((o) => o.value === data.answers[q.key]))
        answers[q.key] = data.answers[q.key];
    }
    for (const q of getStrategyQuestions(answers, "ko")) {
      if (q.options.some((o) => o.value === data.answers[q.key]))
        answers[q.key] = data.answers[q.key];
    }
    const questions = [
      ...getQuestions("ko"),
      ...getStrategyQuestions(answers, "ko"),
    ];
    const missing = questions.findIndex((q) => !answers[q.key]);
    const complete = isComplete(answers) && missing === -1;
    const step = Number.isInteger(data.step)
      ? Math.max(
          0,
          Math.min(
            questions.length - 1,
            data.step,
            missing < 0 ? questions.length - 1 : missing,
          ),
        )
      : 0;
    return { answers, step, finished: data.finished === true && complete };
  } catch {
    return null;
  }
}
