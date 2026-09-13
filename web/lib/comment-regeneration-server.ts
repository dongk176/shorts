import "server-only";
import type { OutputLanguage } from "./contracts";
import { CULTURE_COMMENT_MODEL, usesCulturalComments, type CommentProfile } from "./comment-profile";
import {
  buildCommentRegenerationMessages,
  commentRegenerationResponseSchema,
  parseCommentRegenerationResponse,
  type CommentRejectionCounts,
} from "@/lib/comment-regeneration";

const DEFAULT_GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_GEMINI_COMMENT_MODEL = "gemini-2.5-flash-lite";
const GEMINI_COMMENT_TIMEOUT_MS = 45_000;

type GenerateCommentsInput = {
  title: string;
  highlightReason: string;
  transcript: Array<{ start: number; end: number; text: string }>;
  targetCount: number;
  outputLanguage?: OutputLanguage;
  sourceLanguage?: string;
  commentProfile?: CommentProfile;
};

export function paidGeminiCommentGenerationEnabled(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return Boolean(
    environment.GEMINI_API_KEY
    && environment.GEMINI_PAID_DATA_PROCESSING_CONFIRMED?.trim().toLowerCase() === "true",
  );
}

export async function generateCommentsWithGemini(
  input: GenerateCommentsInput,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!paidGeminiCommentGenerationEnabled(environment)) {
    throw new Error("paid_gemini_not_configured");
  }
  const baseUrl = environment.GEMINI_OPENAI_BASE_URL
    || DEFAULT_GEMINI_OPENAI_BASE_URL;
  const endpoint = new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const configuredLimit = environment.GEMINI_MAX_OUTPUT_TOKENS?.trim();
  const parsedLimit = Number(configuredLimit);
  const maxTokens = Number.isInteger(parsedLimit)
    ? Math.min(65_536, Math.max(1_024, parsedLimit)) : 16_384;
  const model = usesCulturalComments(input.commentProfile, input.outputLanguage)
    ? CULTURE_COMMENT_MODEL
    : environment.GEMINI_COMMENT_MODEL || environment.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_COMMENT_MODEL;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.GEMINI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: buildCommentRegenerationMessages(input),
      ...(configuredLimit ? { max_tokens: maxTokens } : {}),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "comment_regeneration_response",
          strict: true,
          schema: commentRegenerationResponseSchema(input.targetCount),
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(GEMINI_COMMENT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`gemini_http_${response.status}`);
  const rejectionCounts: CommentRejectionCounts = {};
  let qualityStatus = "rejected";
  try {
    const comments = parseCommentRegenerationResponse(
      await response.json(), input.targetCount, input.outputLanguage, rejectionCounts,
      input.sourceLanguage === undefined ? undefined : input.transcript.map((s) => s.text).join("\n"),
    );
    qualityStatus = "complete";
    return comments;
  } finally {
    console.info("comment_regeneration_validation", {
      model,
      outputLanguage: input.outputLanguage || "ko",
      targetCount: input.targetCount,
      qualityStatus,
      rejectedCommentCounts: rejectionCounts,
    });
  }
}
