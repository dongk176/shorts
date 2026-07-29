"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import {
  SITE_FOOTER_VISIBLE,
  TEAM_PAGE_VISIBLE,
} from "@/lib/site-visibility";

export function SiteFooter() {
  const { t } = useI18n();

  if (!SITE_FOOTER_VISIBLE) {
    return null;
  }

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <Link href="/" className="site-footer-brand" aria-label={t("nav.homeLabel")}>
          <span className="brand-type">Easy <em>Cut</em></span>
          <span>© 2026</span>
        </Link>
        <ul className="site-footer-business" aria-label={t("footer.businessInfo")}>
          <li>{t("footer.company")}</li>
          <li>{t("footer.representative")}</li>
          <li>{t("footer.businessNumber")}</li>
          <li>{t("footer.ecommerceNumber")}</li>
          <li><a href="tel:010-4836-2874">{t("footer.supportPhone")}</a></li>
        </ul>
        <nav className="site-footer-links" aria-label={t("footer.links")}>
          <Link href="/pricing">{t("nav.pricing")}</Link>
          {TEAM_PAGE_VISIBLE ? (
            <Link href="/team">{t("footer.team")}</Link>
          ) : null}
          <Link href="/faq">{t("footer.faq")}</Link>
          <Link href="/terms">{t("footer.terms")}</Link>
          <Link href="/purchase-terms">{t("footer.purchaseTerms")}</Link>
          <Link href="/refund">{t("footer.refund")}</Link>
          <Link href="/privacy">{t("footer.privacy")}</Link>
          <Link href="/support">{t("footer.support")}</Link>
        </nav>
      </div>
    </footer>
  );
}
