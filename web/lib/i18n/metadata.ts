import "server-only";
import { createPageMetadata } from "@/lib/seo";
import { translateLegacyDocumentTitle, translateLegacyText } from "./legacy-phrases";
import { getRequestLocale } from "./server";
import { seoCopyForPath } from "@/lib/seo-localization";

export async function createLocalizedPageMetadata(options: Parameters<typeof createPageMetadata>[0]) {
  const locale = await getRequestLocale();
  const copy = seoCopyForPath(options.path, locale);
  return createPageMetadata({ ...options, locale,
    title: copy?.title ?? translateLegacyDocumentTitle(options.title, locale),
    description: copy?.description ?? (locale === "ko" ? options.description : translateLegacyText(options.description, locale)),
  });
}
