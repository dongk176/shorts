export function analyticsSafePathname(pathname: string) {
  return /^\/creator-project\/[^/]+(?:\/|$)/.test(pathname)
    ? "/creator-project/[token]"
    : pathname;
}
