import type { UsageSnapshot } from "@/lib/contracts";

export function assertJobCreationAllowed(input: {
  activeJobs: number;
  maxActiveJobs: number;
  sourceDurationSeconds: number;
  usage: UsageSnapshot;
}) {
  if (input.activeJobs >= input.maxActiveJobs) {
    throw new Error("현재 처리 중인 작업이 있습니다. 완료 후 다시 시도해 주세요.");
  }
  if (
    input.usage.enforcementEnabled
    && input.usage.usedSeconds + input.usage.reservedSeconds + input.sourceDurationSeconds
      > input.usage.limitSeconds
  ) {
    throw new Error("선택한 플랜의 이번 달 원본 영상 처리 시간을 초과합니다.");
  }
}
