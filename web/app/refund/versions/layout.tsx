import { notFound } from "next/navigation";

/**
 * Historical refund policies remain available to internal billing logic through
 * the version stored on each order, but are not public customer-facing pages.
 */
export default function ArchivedRefundPolicyVersionsLayout() {
  notFound();
}
