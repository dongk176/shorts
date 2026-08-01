import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_COMMENT_MAX_CHARS,
  AI_COMMENT_MIN_CHARS,
  buildCommentRegenerationMessages,
  commentRegenerationResponseSchema,
  parseCommentRegenerationResponse,
} from "@/lib/comment-regeneration";

const routeSource = readFileSync(
  new URL(
    "../app/api/shorts/[shortId]/regenerate-comments/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const serverSource = readFileSync(
  new URL("./comment-regeneration-server.ts", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../app/shorts-app.tsx", import.meta.url),
  "utf8",
);
const usageMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202607310001_ai_comment_regeneration_usage.sql",
    import.meta.url,
  ),
  "utf8",
);
const auditRetentionMigration = readFileSync(
  new URL(
    "../../supabase/migrations/202608020001_ai_comment_regeneration_audit_retention.sql",
    import.meta.url,
  ),
  "utf8",
);

function providerResponse(comments: string[]) {
  return {
    choices: [{
      message: {
        content: JSON.stringify({ comments }),
      },
    }],
  };
}

describe("AI comment regeneration", () => {
  it("builds the existing Korean comment-writer prompt from the short context", () => {
    const messages = buildCommentRegenerationMessages({
      title: "결승전 마지막 한타",
      highlightReason: "예상 밖의 역전",
      transcript: [
        { start: 0, end: 1, text: "이걸 들어가네" },
        { start: 1, end: 2, text: "진짜 끝났습니다" },
      ],
      targetCount: 3,
    });

    expect(messages[0].content).toContain("한국 유튜브와 숏폼 커뮤니티");
    expect(messages[0].content).toContain("정확히 3개의 댓글");
    expect(messages[1].content).toContain("후킹 제목: 결승전 마지막 한타");
    expect(messages[1].content).toContain("선정 이유: 예상 밖의 역전");
    expect(messages[1].content).toContain("이걸 들어가네\n진짜 끝났습니다");
  });

  it("requires exactly the current overlay count in the provider schema", () => {
    const schema = commentRegenerationResponseSchema(7);
    expect(schema.properties.comments.minItems).toBe(7);
    expect(schema.properties.comments.maxItems).toBe(7);
    expect(schema.properties.comments.items.minLength).toBe(AI_COMMENT_MIN_CHARS);
    expect(schema.properties.comments.items.maxLength).toBe(AI_COMMENT_MAX_CHARS);
  });

  it("normalizes valid comments and rejects missing or duplicate results", () => {
    expect(parseCommentRegenerationResponse(providerResponse([
      "이 장면  진짜 웃기다",
      "마지막 반응이 킬포네 ㅋㅋ",
    ]), 2)).toEqual([
      "이 장면 진짜 웃기다",
      "마지막 반응이 킬포네 ㅋㅋ",
    ]);

    expect(() => parseCommentRegenerationResponse(providerResponse([
      "같은 댓글이다",
      "같은 댓글이다!!",
    ]), 2)).toThrow("wrong_comment_count");
    expect(() => parseCommentRegenerationResponse(providerResponse([
      "댓글 하나뿐",
    ]), 2)).toThrow("wrong_comment_count");
  });

  it("uses paid Gemini and the stored transcript without exposing the key", () => {
    expect(serverSource).toContain("GEMINI_PAID_DATA_PROCESSING_CONFIRMED");
    expect(serverSource).toContain("gemini-2.5-flash-lite");
    expect(serverSource).toContain("Authorization: `Bearer ${environment.GEMINI_API_KEY}`");
    expect(routeSource).toContain("generated_short.subtitle_segments");
    expect(routeSource).toContain("generateCommentsWithGemini");
    expect(routeSource).not.toMatch(/console\.(?:log|error).*GEMINI_API_KEY/);
  });

  it("reserves exactly one minute and releases it when generation fails", () => {
    expect(usageMigration).toContain("usage_seconds integer not null default 60");
    expect(usageMigration).toContain("remaining integer := 60");
    expect(usageMigration).toContain("status='consumed'");
    expect(usageMigration).toContain("status='released'");
    expect(routeSource).toContain("COMMENT_REGENERATION_USAGE_SECONDS = 60");
    expect(routeSource).toContain("failure_code='gemini_generation_failed'");
  });

  it("releases stale reservations before checking remaining usage", () => {
    const staleRelease = routeSource.indexOf("failure_code='stale_request'");
    const usageCheck = routeSource.indexOf(
      "usageBefore.remainingSeconds < COMMENT_REGENERATION_USAGE_SECONDS",
    );
    expect(staleRelease).toBeGreaterThan(-1);
    expect(usageCheck).toBeGreaterThan(staleRelease);
    expect(usageMigration).toContain(
      "created_at<clock_timestamp()-interval '5 minutes'",
    );
  });

  it("retains consumed AI usage evidence after the browser session is deleted", () => {
    expect(auditRetentionMigration).toContain(
      "alter column mvp_session_id drop not null",
    );
    expect(auditRetentionMigration).toContain("on delete set null");
    expect(auditRetentionMigration).toContain("not valid");
    expect(auditRetentionMigration).toContain(
      "shorts_mvp.ai_comment_regeneration_requests",
    );
    expect(auditRetentionMigration).not.toContain("public.");
  });

  it("keeps the confirmation copy and undoable comment replacement in the editor", () => {
    expect(editorSource).toContain("AI로 댓글 재생성");
    expect(editorSource).toContain("댓글 재생성은 사용량 1분을 소모합니다.");
    expect(editorSource).toContain("어떤 댓글을 사용할까요?");
    expect(editorSource).toContain("모두 기존 댓글");
    expect(editorSource).toContain("모두 새 댓글");
    expect(editorSource).toContain("선택한 댓글 적용");
    expect(editorSource).toContain("max-w-[760px]");
    expect(editorSource).not.toContain("생성 사용량 1분은 이미 반영되었어요.");
    expect(editorSource).toContain('"comment-replace"');
    expect(editorSource).toContain("recordEditorCommentReplacement(before, after)");
  });

  it("keeps generated comments pending until the user applies their choices", () => {
    const regenerationStart = editorSource.indexOf(
      "const regenerateEditorComments = useCallback(async () =>",
    );
    const regenerationEnd = editorSource.indexOf(
      "const beginEditorOverlayHistoryInteraction",
      regenerationStart,
    );
    const regenerationFlow = editorSource.slice(regenerationStart, regenerationEnd);
    expect(regenerationFlow).toContain("setCommentRegenerationComparison({");
    expect(regenerationFlow).not.toContain("setComments(after)");
    expect(editorSource).toContain(
      "const applyRegeneratedCommentComparison = useCallback(() =>",
    );
    expect(editorSource).toContain("setComments(after)");
  });

  it("lets users edit either comparison option before applying it", () => {
    expect(editorSource).toContain("더블클릭해서 직접 수정하세요.");
    expect(editorSource).toContain("더블클릭해서 수정");
    expect(editorSource).toContain("onDoubleClick={(event) => {");
    expect(editorSource).toContain("onTextChange={updateRegeneratedCommentText}");
    expect(editorSource).toContain(
      "existingTexts: before.map((comment) => comment.text)",
    );
    expect(editorSource).toContain("comparison.existingTexts[index]");
    expect(editorSource).toContain("selectedTexts[index]");
    expect(editorSource).toContain("disabled={!selectedCommentsValid}");
  });
});
