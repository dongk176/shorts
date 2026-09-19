import "server-only";
import { createPageMetadata } from "@/lib/seo";
import { translateLegacyDocumentTitle, translateLegacyText } from "./legacy-phrases";
import { getRequestLocale } from "./server";

export async function createLocalizedPageMetadata(options: Parameters<typeof createPageMetadata>[0]) {
  const locale = await getRequestLocale();
  return createPageMetadata({ ...options, locale,
    title: translateLegacyDocumentTitle(options.title, locale),
    description: locale === "ko" ? options.description : translateLegacyText(options.description, locale),
  });
}
