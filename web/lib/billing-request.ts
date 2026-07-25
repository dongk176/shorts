import { HttpError } from "@/lib/http";

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function normalizeOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originFromHost(protocol: string, host: string | null) {
  if (!host || (protocol !== "http:" && protocol !== "https:")) return null;
  return normalizeOrigin(`${protocol}//${host}`);
}

function requestOriginCandidates(request: Request) {
  const requestUrl = new URL(request.url);
  const requestProtocol = requestUrl.protocol;
  const forwardedProtocolValue = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const forwardedProtocol = forwardedProtocolValue ? `${forwardedProtocolValue.replace(/:$/, "")}:` : null;
  const host = firstHeaderValue(request.headers.get("host"));
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const candidates = new Set<string>([requestUrl.origin]);

  for (const candidateHost of [forwardedHost, host]) {
    for (const protocol of [forwardedProtocol, requestProtocol]) {
      if (!protocol) continue;
      const origin = originFromHost(protocol, candidateHost);
      if (origin) candidates.add(origin);
    }
  }
  return candidates;
}

function verifiedBrowserOrigin(request: Request) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin) return null;
  const origin = normalizeOrigin(rawOrigin);
  if (!origin || !requestOriginCandidates(request).has(origin)) {
    throw new HttpError(403, "다른 출처에서 보낸 결제 요청은 허용되지 않습니다.");
  }
  return origin;
}

export function assertBillingMutationRequest(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "JSON 형식의 결제 요청만 허용됩니다.");
  }
  verifiedBrowserOrigin(request);
}

export function billingRequestOrigin(request: Request) {
  return verifiedBrowserOrigin(request)
    || originFromHost(
      `${(firstHeaderValue(request.headers.get("x-forwarded-proto")) || "").replace(/:$/, "")}:`,
      firstHeaderValue(request.headers.get("x-forwarded-host")),
    )
    || new URL(request.url).origin;
}

export function checkoutUrls(request: Request, flow: "subscription" | "addon", checkoutId: string) {
  const origin = billingRequestOrigin(request);
  const success = new URL("/billing/success", origin);
  success.searchParams.set("flow", flow);
  success.searchParams.set("checkoutId", checkoutId);
  const fail = new URL("/billing/fail", origin);
  fail.searchParams.set("flow", flow);
  fail.searchParams.set("checkoutId", checkoutId);
  return { successUrl: success.toString(), failUrl: fail.toString() };
}
