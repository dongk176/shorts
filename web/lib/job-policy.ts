import type { UsageSnapshot } from "@/lib/contracts";
import { HttpError } from "@/lib/http";

export const RESTRICTED_CONTENT_FAILURE_LIMIT = 3;
export const RESTRICTED_CONTENT_FAILURE_WINDOW_MINUTES = 10;

export function assertRestrictedContentCooldown(cooldownMinutes: number) {
  const remainingMinutes = Math.max(0, Math.ceil(cooldownMinutes));
  if (remainingMinutes > 0) {
    throw new HttpError(
      429,
      `너무 자주 요청이 발생하여 잠시 ${remainingMinutes}분 동안 작업을 할 수 없습니다.`,
      "RESTRICTED_CONTENT_COOLDOWN",
    );
  }
}

export function assertJobCreationAllowed(input: {
  activeJobs: number;
  maxActiveJobs: number;
  sourceDurationSeconds: number;
  usage: UsageSnapshot;
}) {
  if (input.activeJobs >= input.maxActiveJobs) {
    throw new HttpError(409, "현재 처리 중인 작업이 있습니다. 완료 후 다시 시도해 주세요.");
  }
  if (
    input.usage.enforcementEnabled
    && input.sourceDurationSeconds > input.usage.remainingSeconds
  ) {
    throw new HttpError(402, "사용 가능한 원본 영상 처리 시간이 부족합니다.");
  }
}
