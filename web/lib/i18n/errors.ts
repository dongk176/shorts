import { normalizeSiteLocale, type SiteLocale } from "./config";
import { messagesByLocale, type MessageKey } from "./messages";
import { safeUserFacingErrorMessage } from "@/lib/public-error";

export type ApiErrorBody = {
  detail?: string;
  code?: string;
};

function errorMessageKey(code: string | null | undefined): MessageKey | null {
  if (!code) return null;
  const key = `error.${code}` as MessageKey;
  return key in messagesByLocale.ko ? key : null;
}

export function localizeApiError(
  body: ApiErrorBody,
  status: number,
  locale: SiteLocale,
  fallbackKey: MessageKey = "common.genericError",
) {
  const messages = messagesByLocale[locale];
  const detail = safeUserFacingErrorMessage(body.detail);
  if (
    locale === "ko"
    && detail
    && /[가-힣]/.test(detail)
    && (!body.code || body.code === `HTTP_${status}`)
  ) {
    return detail;
  }
  const explicitKey = errorMessageKey(body.code);
  if (explicitKey) return messages[explicitKey];
  if (locale === "ko" && detail && /[가-힣]/.test(detail)) return detail;
  const statusKey = errorMessageKey(`HTTP_${status}`);
  return statusKey ? messages[statusKey] : messages[fallbackKey];
}

export function currentClientLocale(): SiteLocale {
  if (typeof document === "undefined") return "ko";
  return normalizeSiteLocale(document.documentElement.lang.split("-", 1)[0]);
}

export function localizeAuthError(code: string | null, locale: SiteLocale) {
  if (!code) return null;
  const key = errorMessageKey(code);
  return key ? messagesByLocale[locale][key] : messagesByLocale[locale]["error.AUTH_CALLBACK_FAILED"];
}
