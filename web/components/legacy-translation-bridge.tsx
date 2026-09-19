"use client";

import { useEffect } from "react";
import { translateLegacyDocumentTitle, translateLegacyText } from "@/lib/i18n/legacy-phrases";
import type { SiteLocale } from "@/lib/i18n/config";

const translatedAttributes = ["aria-label", "placeholder", "title", "alt", "data-tooltip"] as const;

function shouldSkip(node: Node) {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return Boolean(element?.closest("[data-i18n-skip], [translate='no'], script, style, code, pre"));
}

function shouldSkipText(node: Node) {
  if (shouldSkip(node)) return true;
  // Video content stays as authored. Tool labels within the canvas can opt
  // back into the site language; accessible attributes remain UI text.
  return Boolean(node.parentElement
    ?.closest("[data-i18n-content], [data-i18n-ui]")
    ?.hasAttribute("data-i18n-content"));
}

type Translation = { original: string; translated: string };
const textTranslations = new Map<Node, Translation>();
const attributeTranslations = new Map<Element, Map<string, Translation>>();

function translateText(node: Node, locale: "en" | "ja") {
  const value = node.nodeValue || "";
  if (textTranslations.get(node)?.translated === value) return;
  const translated = translateLegacyText(value, locale);
  if (translated !== value) {
    textTranslations.set(node, { original: value, translated });
    node.nodeValue = translated;
  }
}

function translateElement(element: Element, locale: "en" | "ja") {
  if (shouldSkip(element)) return;
  for (const attribute of translatedAttributes) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const translated = translateLegacyText(value, locale);
    if (translated !== value) {
      const attributes = attributeTranslations.get(element) ?? new Map<string, Translation>();
      attributes.set(attribute, { original: value, translated });
      attributeTranslations.set(element, attributes);
      element.setAttribute(attribute, translated);
    }
  }
}

function translateTree(root: Node, locale: "en" | "ja") {
  if (shouldSkip(root)) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (shouldSkipText(root)) return;
    translateText(root, locale);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) translateElement(root as Element, locale);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE && !shouldSkipText(current)) {
      translateText(current, locale);
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      translateElement(current as Element, locale);
    }
    current = walker.nextNode();
  }
}

export function LegacyTranslationBridge({ locale }: { locale: SiteLocale }) {
  useEffect(() => {
    if (locale === "ko") return;
    translateTree(document.body, locale);
    const translateTitle = () => {
      const translated = translateLegacyDocumentTitle(document.title, locale);
      if (translated !== document.title) document.title = translated;
    };
    translateTitle();
    const observer = new MutationObserver((mutations) => {
      // The locale picker updates <html lang> before router.refresh(). Ignore
      // mutations queued for the previous locale so they cannot overwrite the
      // newly rendered messages while React is committing the refreshed tree.
      if (document.documentElement.lang !== locale) return;
      // Release detached page nodes during ordinary navigation.
      for (const node of textTranslations.keys()) if (!node.isConnected) textTranslations.delete(node);
      for (const node of attributeTranslations.keys()) if (!node.isConnected) attributeTranslations.delete(node);
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateTree(mutation.target, locale);
        for (const node of mutation.addedNodes) translateTree(node, locale);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const titleObserver = new MutationObserver(translateTitle);
    titleObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      titleObserver.disconnect();
      // Restore only text still owned by this bridge. React-rendered updates
      // take precedence. This lets locale changes keep the live form mounted.
      for (const [node, value] of textTranslations) {
        if (node.nodeValue === value.translated) node.nodeValue = value.original;
      }
      for (const [element, attributes] of attributeTranslations) {
        for (const [attribute, value] of attributes) {
          if (element.getAttribute(attribute) === value.translated) element.setAttribute(attribute, value.original);
        }
      }
      textTranslations.clear();
      attributeTranslations.clear();
    };
  }, [locale]);

  return null;
}
