// Only fixed codes and product copy may leave the upload boundary. Never retain
// provider messages, OAuth material, request URLs or resumable session URLs.
export const uploadMessages = {
  channel_limit: 'YouTube 채널의 업로드 한도에 도달했습니다. YouTube Studio에서 제한 안내를 확인해 주세요.',
  quota: '이지컷의 YouTube API 할당량을 초과했습니다. 고객지원에 문의해 주세요.',
  auth: 'YouTube 인증을 확인하지 못했습니다. 연결 상태를 확인해 주세요.',
  permission: 'YouTube가 업로드 권한을 허용하지 않았습니다. 채널 권한과 제한 상태를 확인해 주세요.',
  rate: 'YouTube 요청이 일시적으로 제한됐습니다. 잠시 후 상태를 확인해 주세요.',
  provider: 'YouTube 서버 오류로 업로드가 중단됐습니다. 잠시 후 상태를 확인해 주세요.',
  network: 'YouTube와 통신하지 못해 업로드가 중단됐습니다. 연결 상태를 확인해 주세요.',
  timeout: 'YouTube 응답 대기 시간이 초과됐습니다. 업로드 상태를 확인해 주세요.',
  uncertain: '이전 업로드 시작 결과를 확인할 수 없어 중복 방지를 위해 재전송을 멈췄습니다. 고객지원에 문의해 주세요.',
  rejected: 'YouTube가 요청을 거절했습니다. 고객지원에 문의해 주세요.',
  unknown: '업로드 처리 중 오류가 발생했습니다. 고객지원에 문의해 주세요.',
};
const reasons = new Set(['uploadLimitExceeded','quotaExceeded','dailyLimitExceeded','rateLimitExceeded','userRateLimitExceeded','invalid_grant','invalid_client','unauthorized','forbidden','insufficientPermissions','youtubeSignupRequired']);
const stages = new Set(['source','access','token','channels','session','probe','transfer','verify','resume_guard','save']);
export class UploadFailure extends Error {
  constructor(code, stage, status = null, reason = null) {
    super(uploadMessages[code] || uploadMessages.unknown);
    this.code = Object.hasOwn(uploadMessages, code) ? code : 'unknown';
    this.stage = stages.has(stage) ? stage : 'unknown';
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.reason = reasons.has(reason) ? reason : null;
  }
}
export async function providerFailure(response, stage) {
  let reason;
  try {
    const body = await response.clone().json();
    const candidates = [body?.error, ...(Array.isArray(body?.error?.errors) ? body.error.errors.map(e => e?.reason) : [])];
    reason = candidates.find(value => reasons.has(value));
  } catch { /* Invalid provider bodies must never become log messages. */ }
  const status = response.status;
  const code = reason === 'uploadLimitExceeded' ? 'channel_limit'
    : ['quotaExceeded','dailyLimitExceeded'].includes(reason) ? 'quota'
    : ['rateLimitExceeded','userRateLimitExceeded'].includes(reason) || status === 429 ? 'rate'
    : ['invalid_grant','invalid_client','unauthorized'].includes(reason) || status === 401 ? 'auth'
    : status >= 500 ? 'provider'
    : status === 403 ? 'permission' : 'rejected';
  return new UploadFailure(code, stage, status, reason);
}
export function uploadDiagnostic(error, stage) {
  const failure = error instanceof UploadFailure ? error : new UploadFailure('unknown', stage);
  return { code: failure.code, stage: failure.stage, status: failure.status, reason: failure.reason, message: uploadMessages[failure.code] };
}
