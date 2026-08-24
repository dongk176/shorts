"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { claimSidebarNavigationAnnouncement } from "@/app/actions/sidebar-navigation-announcement";
import { useUsageState } from "@/components/usage-provider";
import { useWelcomeOverlayStage } from "@/components/welcome-overlay-queue";
import { shouldClaimSidebarNavigationAnnouncement } from "@/lib/sidebar-navigation-announcement";

export function SidebarNavigationAnnouncement() {
  const pathname = usePathname();
  const { authenticated } = useUsageState();
  const {
    active: queueActive,
    complete: completeQueueStage,
  } = useWelcomeOverlayStage("sidebar-navigation");
  const claimStartedRef = useRef(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!authenticated || !queueActive) {
      claimStartedRef.current = false;
      setVisible(false);
      return;
    }
    if (claimStartedRef.current) return;

    const desktop = window.matchMedia("(min-width: 768px)").matches;
    const sidebarVisible = Boolean(document.querySelector(".desktop-sidebar-layout"));
    if (!shouldClaimSidebarNavigationAnnouncement({
      authenticated,
      queueActive,
      pathname,
      desktop,
      sidebarVisible,
    })) {
      completeQueueStage();
      return;
    }

    claimStartedRef.current = true;
    let cancelled = false;
    void claimSidebarNavigationAnnouncement()
      .then((announcement) => {
        if (cancelled) return;
        if (!announcement) {
          completeQueueStage();
          return;
        }
        setVisible(true);
      })
      .catch(() => {
        if (!cancelled) completeQueueStage();
      });
    return () => {
      cancelled = true;
    };
  }, [
    authenticated,
    completeQueueStage,
    pathname,
    queueActive,
  ]);

  useEffect(() => {
    if (!visible) return;
    document.documentElement.classList.add("sidebar-announcement-open");
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setVisible(false);
        completeQueueStage();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.documentElement.classList.remove("sidebar-announcement-open");
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [completeQueueStage, visible]);

  if (!visible) return null;

  const close = () => {
    setVisible(false);
    completeQueueStage();
  };

  return (
    <div
      className="sidebar-announcement-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="sidebar-announcement-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sidebar-navigation-announcement-title"
        aria-describedby="sidebar-navigation-announcement-description"
      >
        <span className="sidebar-announcement-eyebrow">새로운 메뉴</span>
        <h2 id="sidebar-navigation-announcement-title">
          이제 메뉴를 왼쪽 사이드바에서 확인하세요
        </h2>
        <p id="sidebar-navigation-announcement-description">
          프로젝트, 템플릿, 요금제와 설정으로 더 빠르게 이동할 수 있어요.
        </p>
        <button type="button" onClick={close} autoFocus>
          확인했어요
        </button>
      </section>
    </div>
  );
}
