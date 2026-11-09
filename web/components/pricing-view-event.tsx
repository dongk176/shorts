"use client";
import { useEffect, useRef } from "react";
import { trackConversion } from "@/lib/conversion-events-client";
import type { SiteLocale } from "@/lib/i18n/config";

export function PricingViewEvent({ locale, loggedIn }: { locale: SiteLocale; loggedIn: boolean }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (!loggedIn || sent.current === locale) return;
    sent.current = locale;
    trackConversion({ name: "pricing_viewed", locale, surface: "pricing" });
  }, [locale, loggedIn]);
  return null;
}
