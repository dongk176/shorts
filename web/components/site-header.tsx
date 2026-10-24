"use client";

import Image from "next/image";
import Link from "@/lib/i18n/navigation";
import { usePathname } from "@/lib/i18n/navigation";
import type { ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { HeaderUsageIndicator } from "@/components/header-usage-indicator";
import { useUsageState } from "@/components/usage-provider";
import { NewUpdateBadge, useRecentUpdates } from "@/components/recent-updates-provider";
import { useI18n } from "@/lib/i18n/provider";

const navigation = [
  { href: "/projects", labelKey: "nav.projects", path: "/projects" },
  { href: "/templates", labelKey: "nav.templates", path: "/templates" },
  { href: "/pricing", labelKey: "nav.pricing", path: "/pricing" },
  { href: "/popular", labelKey: "nav.popular", path: "/popular" },
  { href: "/saved-videos", labelKey: "nav.savedVideos", path: "/saved-videos" },
  { href: "/publish/channels", labelKey: "nav.channels", path: "/publish/channels" },
  { href: "/shorts-monetization", labelKey: "nav.shortsGuide", path: "/shorts-monetization" },
  { href: "/updates", labelKey: "nav.updates", path: "/updates" },
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

  if (path === "/ranking-shorts") {
    return <span className="site-nav-icon-frame" aria-hidden="true"><svg {...sharedProps}><path d="M3 21h18M4 21V11h5v10M9 21V4h6v17M15 21v-7h5v7" /></svg></span>;
  }
  if (path === "/updates") {
    return <span className="site-nav-icon-frame" aria-hidden="true"><svg {...sharedProps}><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 7h8M8 11h8M8 15h5M8 18h3"/></svg></span>;
  }
  if (path === "/publish/channels") {
    return <span className="site-nav-icon-frame" aria-hidden="true"><svg {...sharedProps}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg></span>;
  }
  if (path === "/account") {
    return <span className="site-nav-icon-frame" aria-hidden="true"><svg {...sharedProps}><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg></span>;
  }
  if (path === "/") {
    return <span className="site-nav-icon-frame" aria-hidden="true"><svg {...sharedProps}><path d="M12 5v14M5 12h14" /></svg></span>;
  }
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
  if (path === "/shorts-monetization") {
    return (
      <span className="site-nav-icon-frame" aria-hidden="true">
        <svg {...sharedProps}>
          <path d="M12 5.5C9 3.5 5.5 3.5 3 4.5v15c2.5-1 6-1 9 1 3-2 6.5-2 9-1v-15c-2.5-1-6-1-9 1Z" />
          <path d="M12 5.5v15M6 8h3M6 11.5h3M15 8h3M15 11.5h3" />
        </svg>
      </span>
    );
  }
  if (path === "/saved-videos") {
    return <span className="site-nav-icon-frame" aria-hidden="true"><svg {...sharedProps}><path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" /></svg></span>;
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
  const hasRecentUpdate = useRecentUpdates();
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // Keep the framework-provided pathname when it is not URI encoded.
  }
  const privateActive = decodedPathname === "/easycut-private";
  const { rankingAdmin } = useUsageState();
  return (
    <>
      {navigation.filter((item) => !isEnterprise || item.path !== "/pricing").map((item) => {
        const active = item.path === decodedPathname;
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={item.href === "/shorts-monetization" ? undefined : false}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`${mobile ? "rounded-xl px-4 py-3" : "nav-link"} ${active ? "text-[#ffb4a8]" : mobile ? "text-neutral-200 hover:bg-white/[.06] hover:text-white" : ""}`}
          >
            <NavigationIcon path={item.path} />
            {t(item.labelKey)}
            {item.path === "/updates" && hasRecentUpdate ? <NewUpdateBadge /> : null}
          </Link>
        );
      })}
      {rankingAdmin ? <Link href="/ranking-shorts" prefetch={false} className={mobile ? "rounded-xl px-4 py-3" : "nav-link"} onClick={onNavigate}><NavigationIcon path="/ranking-shorts" />랭킹 쇼츠</Link> : null}
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

function LegacySiteHeader({
  children,
  showUsageIndicator = true,
  desktopSidebar = false,
}: {
  children: ReactNode;
  showUsageIndicator?: boolean;
  desktopSidebar?: boolean;
}) {
  const pathname = usePathname();
  const { t, locale } = useI18n();
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

  useEffect(() => setMenuOpen(false), [pathname, locale]);

  return (
    <header className={`site-header${desktopSidebar ? " site-header-sidebar" : ""}`}>
      <div className="site-header-inner relative mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" prefetch={false} className="flex shrink-0 items-center gap-3" aria-label={t("nav.homeLabel")}>
          <span className="brand-mark" aria-hidden="true"><Image src="/east-cut-logo.png" alt="" width={34} height={34} priority /></span>
          <span className="brand-type">Easy <em>Cut</em></span>
        </Link>
        <nav className="site-header-primary hidden items-center gap-8 text-sm font-semibold text-neutral-300 md:flex" aria-label={t("nav.primary")}>
          <NavigationLinks pathname={pathname} isEnterprise={isEnterprise} />
          {showUsageIndicator ? <HeaderUsageIndicator /> : null}
        </nav>
        {showUsageIndicator ? <HeaderUsageIndicator mobile /> : null}
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


const sidebarGroups = [
  { id: "creation", labelKey: "nav.group.creation", items: [
    { href: "/projects", labelKey: "nav.projects" },
    { href: "/templates", labelKey: "nav.templates" },
  ] },
  { id: "discovery", labelKey: "nav.group.discovery", items: [
    { href: "/popular", labelKey: "nav.popular" },
    { href: "/saved-videos", labelKey: "nav.savedVideos" },
    { href: "/publish/channels", labelKey: "nav.channels" },
  ] },
  { id: "help", labelKey: "nav.group.help", items: [
    { href: "/pricing", labelKey: "nav.pricing" },
    { href: "/shorts-monetization", labelKey: "nav.shortsGuide" },
    { href: "/updates", labelKey: "nav.updates" },
    { href: "/easycut-private", labelKey: null },
  ] },
] as const;

type SidebarGroup = typeof sidebarGroups[number]["id"];

function SidebarChevron({ sideways = false }: { sideways?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {sideways ? <path d="m14 6-6 6 6 6" /> : <path d="m6 9 6 6 6-6" />}
  </svg>;
}

function GroupedNavigation({ collapsed, groupsOpen, onToggle, onNavigate, isEnterprise, pathname }: {
  collapsed: boolean;
  groupsOpen: Record<SidebarGroup, boolean>;
  onToggle: (group: SidebarGroup) => void;
  onNavigate?: () => void;
  isEnterprise: boolean;
  pathname: string;
}) {
  const { t } = useI18n();
  const hasRecentUpdate = useRecentUpdates();
  const id = useId();
  const { rankingAdmin } = useUsageState();
  return <nav className="sidebar-group-navigation" aria-label={t("nav.primary")}>
    {sidebarGroups.map(group => {
      const items = group.items.filter(item => !isEnterprise || !["/pricing", "/easycut-private"].includes(item.href));
      const open = collapsed || groupsOpen[group.id];
      return <section className="sidebar-nav-group" key={group.id}>
        <h2 className="sidebar-group-heading">
          <button type="button" className="sidebar-group-toggle" aria-expanded={open} aria-controls={`${id}-${group.id}`} onClick={() => onToggle(group.id)} title={t(group.labelKey)}>
            <span className="sidebar-group-label">{t(group.labelKey)}</span>
            {group.id === "help" && hasRecentUpdate ? <NewUpdateBadge /> : null}
            <SidebarChevron />
          </button>
        </h2>
        <div id={`${id}-${group.id}`} className="sidebar-group-items" hidden={!open}>
          {group.id === "creation" && rankingAdmin ? <Link href="/ranking-shorts" prefetch={false} className="sidebar-nav-link" aria-label="랭킹 쇼츠" aria-current={pathname === "/ranking-shorts" ? "page" : undefined} onClick={onNavigate}><NavigationIcon path="/ranking-shorts" /><span className="sidebar-link-label">랭킹 쇼츠</span></Link> : null}
          {items.map(item => {
            const label = item.labelKey ? t(item.labelKey) : "EASYCUT PRIVATE";
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} prefetch={item.href === "/shorts-monetization" || item.href === "/easycut-private" ? undefined : false} className="sidebar-nav-link" aria-label={label} aria-current={active ? "page" : undefined} title={collapsed ? label : undefined} onClick={onNavigate}>
              <NavigationIcon path={item.href} /><span className="sidebar-link-label">{label}</span>
              {item.href === "/updates" && hasRecentUpdate ? <NewUpdateBadge /> : null}
            </Link>;
          })}
        </div>
      </section>;
    })}
  </nav>;
}

function GroupedSiteSidebar({ children, showUsageIndicator }: { children: ReactNode; showUsageIndicator: boolean }) {
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const { isEnterprise } = useUsageState();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState<Record<SidebarGroup, boolean>>({ creation: true, discovery: true, help: false });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const updateViewport = () => setIsMobile(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);
  const toggleGroup = (group: SidebarGroup) => {
    setGroupsOpen(current => ({ ...current, [group]: !current[group] }));
  };

  useEffect(() => setMenuOpen(false), [pathname, locale]);
  // Release drawer scroll lock before an account login portal acquires it.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!menuOpen || !dialog) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const media = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => { if (media.matches) setMenuOpen(false); };
    media.addEventListener("change", closeOnDesktop);
    return () => {
      media.removeEventListener("change", closeOnDesktop);
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  const brand = <Link href="/" prefetch={false} className="sidebar-brand" aria-label={t("nav.homeLabel")} onClick={() => setMenuOpen(false)}>
    <Image src="/east-cut-logo.png" alt="" width={32} height={32} priority /><span className="sidebar-brand-name">Easy <em>Cut</em></span>
  </Link>;
  const navProps = { groupsOpen, onToggle: toggleGroup, isEnterprise, pathname };
  return <>
    <header className={`site-header site-header-sidebar grouped-site-sidebar${collapsed ? " is-collapsed" : ""}`}>
      <div className="sidebar-desktop-content">
        <div className="sidebar-brand-row">{brand}<button type="button" className="sidebar-icon-button sidebar-collapse-button" aria-label={t(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><SidebarChevron sideways /></button></div>
        {showUsageIndicator ? <div className="sidebar-usage"><HeaderUsageIndicator /></div> : null}
        <GroupedNavigation {...navProps} collapsed={collapsed} onToggle={group => {
          if (collapsed) {
            setCollapsed(false);
            setGroupsOpen(current => ({ ...current, [group]: true }));
          } else toggleGroup(group);
        }} />
        <div className="sidebar-account"><div className="sidebar-account-content">{!isMobile ? children : null}</div>{collapsed ? <Link href="/settings" className="sidebar-account-shortcut" aria-label={t("nav.accountSettings")} title={t("nav.accountSettings")}><NavigationIcon path="/account" /></Link> : null}</div>
      </div>
      <div className="sidebar-mobile-bar">
        {brand}{showUsageIndicator ? <HeaderUsageIndicator mobile /> : null}
        <button type="button" className="sidebar-icon-button" aria-label={t("nav.openMenu")} aria-expanded={menuOpen} aria-controls="sidebar-mobile-dialog" onClick={() => setMenuOpen(true)}><svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
      </div>
    </header>
    <dialog ref={dialogRef} id="sidebar-mobile-dialog" className="sidebar-mobile-drawer" aria-label={t("nav.mobilePrimary")} onCancel={() => setMenuOpen(false)} onClose={() => setMenuOpen(false)} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setMenuOpen(false);
    }}>
      <div className="sidebar-drawer-content">
        <div className="sidebar-brand-row">{brand}<button autoFocus type="button" className="sidebar-icon-button" aria-label={t("nav.closeMenu")} onClick={() => setMenuOpen(false)}><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
        {showUsageIndicator ? <div className="sidebar-usage"><HeaderUsageIndicator /></div> : null}
        <GroupedNavigation {...navProps} collapsed={false} onNavigate={() => setMenuOpen(false)} />
        <div className="sidebar-account"><div className="sidebar-account-content" onClick={() => setMenuOpen(false)}>{isMobile ? children : null}</div></div>
      </div>
    </dialog>
  </>;
}

export function SiteHeader(props: { children: ReactNode; showUsageIndicator?: boolean; desktopSidebar?: boolean }) {
  return props.desktopSidebar
    ? <GroupedSiteSidebar showUsageIndicator={props.showUsageIndicator ?? true}>{props.children}</GroupedSiteSidebar>
    : <LegacySiteHeader {...props} />;
}
