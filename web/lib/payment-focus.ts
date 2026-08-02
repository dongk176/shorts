const pendingAdvance = new WeakMap<HTMLInputElement, number>();

function numericLength(input: HTMLInputElement) {
  return input.value.replace(/\D/g, "").length;
}
/**
 * Moves numeric checkout input to the next visible field after a complete
 * value. Ambiguous 6/10 and 10/11 digit fields use a short delay so pasting or
 * continuing to type a business/phone number is not interrupted.
 */
export function advancePaymentFocusIfComplete(target: EventTarget | null) {
  if (!(target instanceof HTMLInputElement)) return;
  const advanceAt = target.dataset.paymentAdvanceAt;
  if (!advanceAt) return;

  const previousTimer = pendingAdvance.get(target);
  if (previousTimer !== undefined) window.clearTimeout(previousTimer);

  const acceptedLengths = advanceAt
    .split(",")
    .map(Number)
    .filter(Number.isFinite);
  if (!acceptedLengths.includes(numericLength(target))) return;

  const delay = Number(target.dataset.paymentAdvanceDelay || 0);
  const timer = window.setTimeout(() => {
    pendingAdvance.delete(target);
    if (
      document.activeElement !== target
      || !acceptedLengths.includes(numericLength(target))
    ) return;
    window.requestAnimationFrame(() => {
      const form = target.form;
      if (!form) return;
      const inputs = Array.from(form.querySelectorAll<HTMLInputElement>(
        'input:not([type="hidden"]):not([disabled])',
      ));
      const next = inputs[inputs.indexOf(target) + 1];
      next?.focus({ preventScroll: true });
    });
  }, Math.max(0, delay));
  pendingAdvance.set(target, timer);
}
