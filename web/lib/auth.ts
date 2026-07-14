export const OAUTH_NEXT_COOKIE = "easy_cut_oauth_next";

export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function requestAppOrigin(request: Pick<Request, "headers" | "url">) {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  if (!host) return requestUrl.origin;
  try {
    const localUrl = new URL(`http://${host}`);
    const hostname = localUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname)) {
      const forwardedProtocol = request.headers.get("x-forwarded-proto");
      const protocol = forwardedProtocol === "https" ? "https:" : "http:";
      return `${protocol}//${host}`;
    }
  } catch {
    // Ignore malformed Host values and use the framework-normalized origin.
  }
  return requestUrl.origin;
}
