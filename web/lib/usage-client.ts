import type { UsageSnapshot } from "@/lib/contracts";

export const USAGE_UPDATED_EVENT = "easycut:usage-updated";

export function publishUsageSnapshot(usage: UsageSnapshot) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<UsageSnapshot>(USAGE_UPDATED_EVENT, { detail: usage }));
}

export function usageFromEvent(event: Event) {
  return (event as CustomEvent<UsageSnapshot>).detail;
}
