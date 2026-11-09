import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { getDb } from "./db";
import { getRequestLocale } from "./i18n/server";
import { saveConversionEvent } from "./conversion-events-store";

export async function recordDownloadRequest(userId: string, surface: "short_download" | "project_download", request: Request) {
  try {
    const locale = await getRequestLocale();
    const country = request.headers.get("x-vercel-ip-country");
    after(async () => {
      try {
        await saveConversionEvent(getDb(), userId, { id: randomUUID(), name: "download_requested", locale, surface }, country);
      } catch { console.warn("conversion_event_save_failed", { event: "download_requested" }); }
    });
  } catch { /* Download availability does not depend on analytics. */ }
}
