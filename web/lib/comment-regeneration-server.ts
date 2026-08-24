import "server-only";
import {
  buildCommentRegenerationMessages,
  commentRegenerationResponseSchema,
  parseCommentRegenerationResponse,
} from "@/lib/comment-regeneration";

const DEFAULT_GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_GEMINI_COMMENT_MODEL = "gemini-2.5-flash-lite";
const GEMINI_COMMENT_TIMEOUT_MS = 45_000;

type GenerateCommentsInput = {
  title: string;
  highlightReason: string;
  transcript: Array<{ start: number; end: number; text: string }>;
  targetCount: number;
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.GEMINI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: environment.GEMINI_COMMENT_MODEL
        || environment.GEMINI_TEXT_MODEL
        || DEFAULT_GEMINI_COMMENT_MODEL,
      messages: buildCommentRegenerationMessages(input),
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
  return parseCommentRegenerationResponse(
    await response.json(),
    input.targetCount,
  );
}
