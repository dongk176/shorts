/** Necessary public-admission check, not proof of a completed creation request. */
export function publicProjectAdmissionOpen(operation: unknown): boolean {
  if (operation === null) return true;
  if (typeof operation !== "object" || Array.isArray(operation)) return false;
  const value = operation as Record<string, unknown>;
  return value.version === 1 && value.phase === "active";
}
