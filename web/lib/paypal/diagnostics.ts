import "server-only";

// Never log provider messages, request/response bodies, query strings, or buyer data.
const token = (value: unknown) => typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : undefined;
export function paypalOperation(path: string) {
  return path.split("?")[0].split("/").map(part => /^(I-|P-)/.test(part) || /^[A-Z0-9]{10,}$/.test(part) ? ":id" : part).join("/");
}
export function logPayPalResponseFailure(path: string, status: number, body: unknown, headerId: string | null) {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const candidate = headerId || data.debug_id;
  const debugId = typeof candidate === "string" && /^[a-f0-9]{13}$/i.test(candidate) ? candidate : undefined;
  const issues = Array.isArray(data.details) ? data.details.slice(0, 5).map(item => token(item?.issue)).filter(Boolean) : [];
  console.error("paypal_api_failed", { operation: paypalOperation(path), status, debugId, name: token(data.name), issues });
}
export function logPayPalTransportFailure(path: string, error: unknown) {
  const name = error instanceof Error && ["AbortError", "TimeoutError", "TypeError"].includes(error.name) ? error.name : "Error";
  console.error("paypal_transport_failed", { operation: paypalOperation(path), errorName: name });
}
