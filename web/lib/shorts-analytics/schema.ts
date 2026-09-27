import { z } from "zod";
import { getQuestions } from "@/app/shorts-monetization/monetization-model";
import { getStrategyQuestions } from "@/app/shorts-monetization/personalized-strategy";
import { guideSlugs } from "@/lib/shorts-guides/catalog";

export const GUIDE_VERSION = "20260927";
const questionKeys = [
  "category",
  "goal",
  "stage",
  "source",
  "format",
  "time",
  "readiness",
  "obstacle",
] as const;
const answers = z
  .object(
    Object.fromEntries(
      questionKeys.map((key) => [key, z.string().max(32).optional()]),
    ) as Record<(typeof questionKeys)[number], z.ZodOptional<z.ZodString>>,
  )
  .strict();
const names = [
  "quiz_started",
  "question_viewed",
  "answer_selected",
  "quiz_completed",
  "quiz_exited",
  "guide_preview",
  "pricing_clicked",
  "result_action",
] as const;
export const eventSchema = z
  .object({
    id: z.uuid(),
    surveyId: z.uuid(),
    sequence: z.number().int().min(1).max(500),
    name: z.enum(names),
    locale: z.enum(["ko", "en", "ja"]),
    version: z.literal(GUIDE_VERSION),
    question: z.enum(questionKeys).optional(),
    answer: z.string().max(32).optional(),
    answers: answers.default({}),
    guide: z.enum(guideSlugs).optional(),
    action: z
      .enum([
        "copy_plan",
        "create_short",
        "filming_checklist",
        "recommended_book",
        "download_attempt",
        "download_success",
      ])
      .optional(),
  })
  .strict()
  .superRefine((event, ctx) => {
    const questions = [
      ...getQuestions("ko"),
      ...getStrategyQuestions(event.answers, "ko"),
    ];
    for (const q of questions) {
      const value = event.answers[q.key];
      if (value !== undefined && !q.options.some((o) => o.value === value))
        ctx.addIssue({
          code: "custom",
          message: "Invalid answer",
          path: ["answers", q.key],
        });
    }
    if (
      ["question_viewed", "answer_selected", "quiz_exited"].includes(
        event.name,
      ) &&
      !event.question
    )
      ctx.addIssue({ code: "custom", message: "Question required" });
    if (
      event.name === "answer_selected" &&
      (!event.answer || event.answers[event.question!] !== event.answer)
    )
      ctx.addIssue({
        code: "custom",
        message: "Selection must match snapshot",
      });
    if (event.name !== "answer_selected" && event.answer !== undefined)
      ctx.addIssue({ code: "custom", message: "Unexpected selection" });
    if (
      event.name === "quiz_completed" &&
      questions.some((q) => !event.answers[q.key])
    )
      ctx.addIssue({ code: "custom", message: "All answers required" });
    if (event.name === "guide_preview" && !event.guide)
      ctx.addIssue({ code: "custom", message: "Guide required" });
    if (event.name === "result_action" && !event.action)
      ctx.addIssue({ code: "custom", message: "Action required" });
  });
export const batchSchema = z
  .object({ events: z.array(eventSchema).min(1).max(20) })
  .strict();
export type GuideEvent = z.infer<typeof eventSchema>;
export type GuideEventInput = Omit<
  GuideEvent,
  "id" | "surveyId" | "sequence" | "version" | "answers"
> & { answers?: GuideEvent["answers"] };
