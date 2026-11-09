import { MAX_SELECTED_SOURCE_SECONDS, MIN_SELECTED_SOURCE_SECONDS } from "./source-range";

// Choosing a plan is navigation, not a job submission. Credit checks must not
// disable the very action that lets the customer obtain more processing time.
export function creationNeedsUpgrade(input: {
  authenticated: boolean;
  enforcementEnabled: boolean;
  canCreateJobs: boolean;
  rewardAvailable: boolean;
  selectionExceedsUsage: boolean;
}) {
  return input.authenticated && input.enforcementEnabled && (
    (!input.canCreateJobs && !input.rewardAvailable) || input.selectionExceedsUsage
  );
}

export function creationActionDisabled(input: {
  creationBlocked: boolean;
  rangeValid: boolean;
  needsUpgrade: boolean;
  busy: boolean;
  stateReady: boolean;
}) {
  return input.creationBlocked || input.busy || !input.stateReady
    || (!input.rangeValid && !input.needsUpgrade);
}

export function initialSourceRangeEnd(durationSeconds: number, availableSeconds: number) {
  return Math.min(durationSeconds, MAX_SELECTED_SOURCE_SECONDS,
    Math.max(MIN_SELECTED_SOURCE_SECONDS, availableSeconds));
}
