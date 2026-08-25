"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { HeaderUsageIndicator } from "@/components/header-usage-indicator";
import { useUsageState } from "@/components/usage-provider";
import { useI18n } from "@/lib/i18n/provider";

const navigation = [
  { href: "/projects", labelKey: "nav.projects", path: "/projects" },
  { href: "/templates", labelKey: "nav.templates", path: "/templates" },
  { href: "/pricing", labelKey: "nav.pricing", path: "/pricing" },
  { href: "/popular", labelKey: "nav.popular", path: "/popular" },
] as const;

function NavigationIcon({ path }: { path: string }) {
  const sharedProps = {
    "aria-hidden": true,
    className: "site-nav-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.85,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (path === "/projects") {
    return (
      <span className="site-nav-icon-frame" aria-hidden="true">
        <svg {...sharedProps}>
          <rect x="3" y="3" width="7" height="9" rx="1.8" />
          <rect x="14" y="3" width="7" height="5" rx="1.8" />
          <rect x="14" y="12" width="7" height="9" rx="1.8" />
          <rect x="3" y="16" width="7" height="5" rx="1.8" />
        </svg>
      </span>
    );
  }
  if (path === "/templates") {
    return (
      <span className="site-nav-icon-frame" aria-hidden="true">
        <svg {...sharedProps}>
          <path d="M3.5 9.25h17v9A2.25 2.25 0 0 1 18.25 20.5H5.75A2.25 2.25 0 0 1 3.5 18.25v-9Z" />
          <path d="m4.15 4.45 15.2-1.9 1 4.25-16.2 2.05-1-2.85a1.25 1.25 0 0 1 1-1.55Z" />
          <path d="m8.25 3.95 3 3.8M14.4 3.15l3 3.8M9.5 12.25l5 2.75-5 2.75v-5.5Z" />
        </svg>
      </span>
    );
  }
  if (path === "/pricing") {
    return (
      <span className="site-nav-icon-frame" aria-hidden="true">
        <svg {...sharedProps}>
          <rect x="2.75" y="5" width="18.5" height="14" rx="2.75" />
          <path d="M2.75 9.5h18.5M6.75 14.75h4.5M16 13.5v3M14.5 15h3" />
        </svg>
      </span>
    );
  }
  if (path === "/popular") {
    return (
      <span className="site-nav-icon-frame" aria-hidden="true">
        <svg {...sharedProps}>
          <path d="M12.1 21.25c4.35 0 7.65-2.95 7.65-7.15 0-3.15-1.8-5.9-4.75-8.2.15 2.35-.75 4.05-2.4 4.95.2-3.95-1.55-6.9-4.5-9.1.25 3.75-4.35 6.25-4.35 12.35 0 4.2 3.45 7.15 8.35 7.15Z" />
          <path d="M9.1 16.2c0 2.15 1.35 3.55 3.2 3.55 1.9 0 3.25-1.35 3.25-3.35 0-1.45-.7-2.65-2.05-3.7-.05 1.1-.5 1.85-1.2 2.3-.2-1.75-.95-3.05-2.15-4 .05 1.65-1.05 3.15-1.05 5.2Z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="site-nav-icon-frame" aria-hidden="true">
      <svg {...sharedProps}>
        <rect x="4.25" y="9.5" width="15.5" height="11.25" rx="2.65" />
        <path d="M7.75 9.5V7.25a4.25 4.25 0 0 1 8.5 0V9.5M12 14v2.75" />
        <circle cx="12" cy="13.75" r=".65" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

function NavigationLinks({ pathname, onNavigate, mobile = false, isEnterprise }: {
  pathname: string;
  onNavigate?: () => void;
  mobile?: boolean;
  isEnterprise: boolean;
}) {
  const { t } = useI18n();
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // Keep the framework-provided pathname when it is not URI encoded.
  }
  const privateActive = decodedPathname === "/easycut-private";
  return (
    <>
      {navigation.filter((item) => !isEnterprise || item.path !== "/pricing").map((item) => {
        const active = item.path === decodedPathname;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`${mobile ? "rounded-xl px-4 py-3" : "nav-link"} ${active ? "text-[#ffb4a8]" : mobile ? "text-neutral-200 hover:bg-white/[.06] hover:text-white" : ""}`}
          >
            <NavigationIcon path={item.path} />
            {t(item.labelKey)}
          </Link>
        );
      })}
      {!isEnterprise ? (
        <Link
          href="/easycut-private"
          onClick={onNavigate}
          aria-current={privateActive ? "page" : undefined}
          className={`${mobile ? "rounded-xl px-4 py-3" : "easycut-private-nav nav-link"} ${privateActive ? "text-[#ffb4a8]" : mobile ? "text-neutral-200 hover:bg-white/[.06] hover:text-white" : ""}`}
        >
          <NavigationIcon path="/easycut-private" />
          EASYCUT PRIVATE
        </Link>
      ) : null}
    </>
  );
}

export function SiteHeader({
  children,
  showUsageIndicator = true,
  desktopSidebar = false,
}: {
  children: ReactNode;
  showUsageIndicator?: boolean;
  desktopSidebar?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { isEnterprise } = useUsageState();
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
    <header className={`site-header${desktopSidebar ? " site-header-sidebar" : ""}`}>
      <div className="site-header-inner relative mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label={t("nav.homeLabel")}>
          <span className="brand-mark" aria-hidden="true"><Image src="/east-cut-logo.png" alt="" width={34} height={34} priority /></span>
          <span className="brand-type">Easy <em>Cut</em></span>
        </Link>
        <nav className="site-header-primary hidden items-center gap-8 text-sm font-semibold text-neutral-300 md:flex" aria-label={t("nav.primary")}>
          <NavigationLinks pathname={pathname} isEnterprise={isEnterprise} />
          {showUsageIndicator ? <HeaderUsageIndicator /> : null}
        </nav>
        <div ref={menuRef} className="site-header-actions relative shrink-0">
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
              <NavigationLinks pathname={pathname} mobile isEnterprise={isEnterprise} onNavigate={() => setMenuOpen(false)} />
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
