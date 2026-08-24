const TECHNICAL_ERROR_PATTERN = new RegExp(
  [
    String.raw`^\s*[\[{]`,
    String.raw`<\/?[a-z][\s\S]*>`,
    String.raw`\b(?:invalid input|invalid_type|too_small|too_big|expected|received)\b`,
    String.raw`\b(?:syntaxerror|typeerror|referenceerror|rangeerror|zoderror)\b`,
    String.raw`\b(?:failed to fetch|networkerror|load failed)\b`,
    String.raw`\b(?:traceback|stack trace|stderr|stdout)\b`,
    String.raw`(?:^|\s)at\s+\S+\s*\(`,
    String.raw`\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b`,
    String.raw`"(?:origin|code|path|message|minimum|maximum)"\s*:`,
  ].join("|"),
  "i",
);

const HANGUL_PATTERN = /[가-힣]/;
const JAPANESE_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const LATIN_PATTERN = /[A-Za-z]/;

export function safeUserFacingErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  if (!message || message.length > 500 || TECHNICAL_ERROR_PATTERN.test(message)) return null;
  return message;
}

export function userFacingErrorMessage(value: unknown, fallback: string): string {
  const raw = value instanceof Error ? value.message : value;
  const message = safeUserFacingErrorMessage(raw);
  if (!message) return fallback;

  const fallbackHasHangul = HANGUL_PATTERN.test(fallback);
  const fallbackHasJapanese = JAPANESE_PATTERN.test(fallback);
  if (fallbackHasHangul && !HANGUL_PATTERN.test(message)) return fallback;
  if (
    !fallbackHasHangul
    && fallbackHasJapanese
    && !JAPANESE_PATTERN.test(message)
  ) return fallback;
  if (
    !fallbackHasHangul
    && !fallbackHasJapanese
    && LATIN_PATTERN.test(fallback)
    && (HANGUL_PATTERN.test(message) || JAPANESE_PATTERN.test(message))
  ) return fallback;

  return message;
}
