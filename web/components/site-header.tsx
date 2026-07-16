"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

const navigation = [
  { href: "/#templates", label: "템플릿", path: null },
  { href: "/pricing", label: "가격", path: "/pricing" },
  { href: "/#results", label: "대시보드", path: null },
  { href: "/실시간인기", label: "실시간 인기", path: "/실시간인기" },
] as const;

function NavigationLinks({ pathname, onNavigate, mobile = false }: {
  pathname: string;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // Keep the framework-provided pathname when it is not URI encoded.
  }
  return navigation.map((item) => {
    const active = item.path === decodedPathname || (item.path === "/실시간인기" && decodedPathname === "/popular");
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`${mobile ? "rounded-xl px-4 py-3" : "nav-link"} ${active ? "text-[#ffb4a8]" : mobile ? "text-neutral-200 hover:bg-white/[.06] hover:text-white" : ""}`}
      >
        {item.label}
      </Link>
    );
  });
}

export function SiteHeader({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
      <div ref={menuRef} className="relative mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="Easy Cut 홈">
          <span className="brand-mark" aria-hidden="true"><Image src="/east-cut-logo.png" alt="" width={34} height={34} priority /></span>
          <span className="brand-type">Easy <em>Cut</em></span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-semibold text-neutral-300 md:flex" aria-label="주요 메뉴">
          <NavigationLinks pathname={pathname} />
        </nav>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 text-neutral-200 transition hover:border-white/25 hover:bg-white/[.06] md:hidden"
            aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-expanded={menuOpen}
            aria-controls="mobile-site-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {menuOpen ? <path d="m6 6 12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          {children}
        </div>
        {menuOpen && (
          <nav
            id="mobile-site-navigation"
            aria-label="모바일 주요 메뉴"
            className="absolute inset-x-5 top-[64px] z-50 grid gap-1 rounded-2xl border border-white/10 bg-[#191c1e]/95 p-2 text-sm font-semibold shadow-[0_24px_70px_rgba(0,0,0,.48)] backdrop-blur-2xl sm:left-auto sm:right-8 sm:w-64 md:hidden"
          >
            <NavigationLinks pathname={pathname} mobile onNavigate={() => setMenuOpen(false)} />
          </nav>
        )}
      </div>
    </header>
  );
}
