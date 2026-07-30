import type { Sql, TransactionSql } from "postgres";

export const EDITOR_RENDERING_V2_FLAG_KEY = "editor_rendering_v2";

type EditorRenderingEnvironment = {
  NODE_ENV?: string;
  EDITOR_RENDERING_V2_ENABLED?: string;
  EDITOR_RENDERING_V2_TEST_USER_IDS?: string;
};

export function editorRenderingV2MasterEnabled(
  environment: EditorRenderingEnvironment = process.env,
) {
  return environment.EDITOR_RENDERING_V2_ENABLED?.trim().toLowerCase() === "true";
}

export function editorRenderingV2TestUserIds(
  environment: EditorRenderingEnvironment = process.env,
) {
  return new Set(
    (environment.EDITOR_RENDERING_V2_TEST_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)),
  );
}

export async function editorRenderingV2Enabled(
  db: Sql | TransactionSql,
  userId: string | null,
  environment: EditorRenderingEnvironment = process.env,
) {
  if (!editorRenderingV2MasterEnabled(environment)) return false;
  if (!userId) return false;
  if (editorRenderingV2TestUserIds(environment).has(userId)) {
    return true;
  }
  const rows = await db`
    select enabled
    from shorts_mvp.runtime_feature_flags
    where flag_key=${EDITOR_RENDERING_V2_FLAG_KEY}
    limit 1
  `;
  return Boolean(rows[0]?.enabled);
}
