import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "./http";
import { shortsSilenceEnabled } from "./shorts-silence-contract";

export async function requireShortsSilenceAdmin(db: Sql | TransactionSql, userId: string | null) {
  const [user] = await db`select u.id,u.is_admin,f.enabled from shorts_mvp.app_users u
    join shorts_mvp.runtime_feature_flags f on f.flag_key='admin_shorts_silence'
    where u.id=${userId} for share of u,f`;
  if (user?.isAdmin !== true || user.enabled !== true || !shortsSilenceEnabled()) throw new HttpError(404, "찾을 수 없습니다.");
}

export async function shortsSilenceRuntimeEnabled(db: Sql | TransactionSql) {
  if (!shortsSilenceEnabled()) return false;
  const [flag] = await db`select enabled from shorts_mvp.runtime_feature_flags where flag_key='admin_shorts_silence'`;
  return flag?.enabled === true;
}

export function assertSilenceTemplate(input: { customTemplateId?: unknown; snsTemplate?: boolean;
  midform?: unknown; languageTest?: boolean; outputLanguage?: string; sourceLanguage?: string }) {
  if (input.customTemplateId || input.snsTemplate || input.midform || input.languageTest || input.sourceLanguage
    || input.outputLanguage && input.outputLanguage !== "ko") {
    throw new HttpError(400, "무음 삭제는 한국어 기본·자막 템플릿에서 사용할 수 있습니다.");
  }
}
