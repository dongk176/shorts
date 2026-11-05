import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { HttpError } from "./http";
import { shortsSilenceEnabled } from "./shorts-silence-contract";

export async function requireShortsSilenceAccess(db: Sql | TransactionSql, userId: string | null) {
  if (!shortsSilenceEnabled() || !userId) throw new HttpError(404, "찾을 수 없습니다.");
  const [user] = await db`select u.id,u.is_admin,f.enabled,coalesce(p.enabled,false) as public_enabled from shorts_mvp.app_users u
    join shorts_mvp.runtime_feature_flags f on f.flag_key='admin_shorts_silence'
    left join shorts_mvp.runtime_feature_flags p on p.flag_key='public_shorts_silence'
    where u.id=${userId} for share of u,f`;
  if ((user?.isAdmin !== true && user?.publicEnabled !== true) || user?.enabled !== true || !shortsSilenceEnabled()) throw new HttpError(404, "찾을 수 없습니다.");
}

export async function shortsSilenceAccessEnabled(db: Sql | TransactionSql, userId: string | null) {
  try { await requireShortsSilenceAccess(db, userId); return true; }
  catch (error) { if (error instanceof HttpError && error.status === 404) return false; throw error; }
}

export async function shortsSilenceRuntimeEnabled(db: Sql | TransactionSql) {
  if (!shortsSilenceEnabled()) return false;
  const [flag] = await db`select enabled from shorts_mvp.runtime_feature_flags where flag_key='admin_shorts_silence'`;
  return flag?.enabled === true;
}

export function assertSilenceTemplate(input: { customTemplateId?: unknown; snsTemplate?: boolean;
  midform?: unknown; languageTest?: boolean; outputLanguage?: string; sourceLanguage?: string }, options: { multilingual?: boolean } = {}) {
  if (input.midform) {
    throw new HttpError(400, "미들폼은 전용 무음 정리 처리를 사용합니다.");
  }
  if (options.multilingual) {
    if ((input.outputLanguage && !["ko", "en", "ja"].includes(input.outputLanguage))
      || (input.sourceLanguage && !["auto", "ko", "en", "ja"].includes(input.sourceLanguage))) {
      throw new HttpError(400, "언어 설정을 확인해 주세요.", "LANGUAGE_TEST_INVALID_INPUT");
    }
  } else if (input.languageTest || input.sourceLanguage || input.outputLanguage && input.outputLanguage !== "ko") {
    throw new HttpError(400, "파일 업로드 무음 삭제는 현재 한국어만 지원합니다.");
  }
}
