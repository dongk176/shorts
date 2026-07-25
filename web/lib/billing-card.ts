export function formatStoredCardLabel(input: {
  last4: string | null | undefined;
}) {
  const last4 = input.last4?.replace(/\D/g, "").slice(-4) || "";
  if (last4.length !== 4) return null;
  return `••${last4}`;
}
