export const MANAGED_ACCOUNT_MIN_ACTIVE_JOBS = 1;
export const MANAGED_ACCOUNT_MAX_ACTIVE_JOBS = 30;
export const MANAGED_ACCOUNT_DEFAULT_ACTIVE_JOBS = 10;

export function resolveManagedAccountMaxActiveJobs(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    && parsed >= MANAGED_ACCOUNT_MIN_ACTIVE_JOBS
    && parsed <= MANAGED_ACCOUNT_MAX_ACTIVE_JOBS
    ? parsed
    : MANAGED_ACCOUNT_DEFAULT_ACTIVE_JOBS;
}
