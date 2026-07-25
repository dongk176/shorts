"use client";

import { useEffect } from "react";
import { translateLegacyText } from "@/lib/i18n/legacy-phrases";
import type { SiteLocale } from "@/lib/i18n/config";

const translatedAttributes = ["aria-label", "placeholder", "title", "alt"] as const;

function shouldSkip(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return Boolean(element?.closest("[data-i18n-skip], [translate='no'], script, style, code, pre"));
}

function translateElement(element: Element, locale: "en" | "ja") {
  if (shouldSkip(element)) return;
  for (const attribute of translatedAttributes) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const translated = translateLegacyText(value, locale);
    if (translated !== value) element.setAttribute(attribute, translated);
  }
}

function translateTree(root: Node, locale: "en" | "ja") {
  if (shouldSkip(root)) return;
  if (root.nodeType === Node.TEXT_NODE) {
    const value = root.nodeValue || "";
    const translated = translateLegacyText(value, locale);
    if (translated !== value) root.nodeValue = translated;
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) translateElement(root as Element, locale);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      const value = current.nodeValue || "";
      const translated = translateLegacyText(value, locale);
      if (translated !== value) current.nodeValue = translated;
    } else {
      translateElement(current as Element, locale);
    }
    current = walker.nextNode();
  }
}

export function LegacyTranslationBridge({ locale }: { locale: SiteLocale }) {
  useEffect(() => {
    if (locale === "ko") return;
    translateTree(document.body, locale);
    document.title = translateLegacyText(document.title, locale);
    const observer = new MutationObserver((mutations) => {
      // The locale picker updates <html lang> before router.refresh(). Ignore
      // mutations queued for the previous locale so they cannot overwrite the
      // newly rendered messages while React is committing the refreshed tree.
      if (document.documentElement.lang !== locale) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateTree(mutation.target, locale);
        for (const node of mutation.addedNodes) translateTree(node, locale);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}
