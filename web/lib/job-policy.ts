import type { UsageSnapshot } from "@/lib/contracts";
import { HttpError } from "@/lib/http";

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
