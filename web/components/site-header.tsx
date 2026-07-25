"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { HeaderUsageIndicator } from "@/components/header-usage-indicator";
import { useI18n } from "@/lib/i18n/provider";

const navigation = [
  { href: "/projects", labelKey: "nav.projects", path: "/projects" },
  { href: "/templates", labelKey: "nav.templates", path: "/templates" },
  { href: "/pricing", labelKey: "nav.pricing", path: "/pricing" },
  { href: "/popular", labelKey: "nav.popular", path: "/popular" },
] as const;

function NavigationLinks({ pathname, onNavigate, mobile = false }: {
  pathname: string;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const { t } = useI18n();
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // Keep the framework-provided pathname when it is not URI encoded.
  }
  return navigation.map((item) => {
    const active = item.path === decodedPathname;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`${mobile ? "rounded-xl px-4 py-3" : "nav-link"} ${active ? "text-[#ffb4a8]" : mobile ? "text-neutral-200 hover:bg-white/[.06] hover:text-white" : ""}`}
      >
        {t(item.labelKey)}
      </Link>
    );
  });
}

export function SiteHeader({
  children,
  showUsageIndicator = true,
}: {
  children: ReactNode;
  showUsageIndicator?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [menuOpen]);

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header className="site-header">
      <div className="relative mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label={t("nav.homeLabel")}>
          <span className="brand-mark" aria-hidden="true"><Image src="/east-cut-logo.png" alt="" width={34} height={34} priority /></span>
          <span className="brand-type">Easy <em>Cut</em></span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-semibold text-neutral-300 md:flex" aria-label={t("nav.primary")}>
          <NavigationLinks pathname={pathname} />
          {showUsageIndicator ? <HeaderUsageIndicator /> : null}
        </nav>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            className="site-header-menu-trigger"
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.openMenu")}
            aria-expanded={menuOpen}
            aria-controls="site-navigation-menu"
            aria-haspopup="true"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="site-header-menu-icon" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <div id="site-navigation-menu" className={`site-header-menu-panel${menuOpen ? " is-open" : ""}`}>
            <nav aria-label={t("nav.mobilePrimary")} className="grid gap-1 md:hidden">
              <NavigationLinks pathname={pathname} mobile onNavigate={() => setMenuOpen(false)} />
            </nav>
            <div className="site-header-menu-account" onClick={() => setMenuOpen(false)}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
