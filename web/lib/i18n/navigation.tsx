"use client";

import NextLink from "next/link";
import { usePathname as useNextPathname, useRouter as useNextRouter } from "next/navigation";
import { forwardRef, useMemo, type ComponentProps } from "react";
import { useNavigationLocale } from "./provider";
import { localePath, localizedHref } from "./routing";

export default forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function LocalizedLink({ href, ...props }, ref) {
  const locale = useNavigationLocale();
  const target = typeof href === "string" ? localizedHref(href, locale)
    : href.host || href.hostname || href.protocol ? href
      : { ...href, pathname: href.pathname ? localizedHref(href.pathname, locale) : href.pathname };
  return <NextLink {...props} ref={ref} href={target} />;
});

// Existing active-navigation and overlay rules operate on the shared page path.
export function usePathname() {
  return localePath(useNextPathname() || "/").pathname;
}

export function useRouter() {
  const router = useNextRouter();
  const locale = useNavigationLocale();
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(localizedHref(href, locale), options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(localizedHref(href, locale), options),
    prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(localizedHref(href, locale), options),
  }), [router, locale]);
}
