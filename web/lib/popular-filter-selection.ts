import type {
  PopularDiscoveryPeriod,
  PopularVideoType,
} from "@/lib/youtube-popular";

export function discoveryPeriodAfterTypeSelection(
  type: PopularVideoType,
  currentPeriod: PopularDiscoveryPeriod,
): PopularDiscoveryPeriod {
  return type === "reusable" ? "today" : currentPeriod;
}
