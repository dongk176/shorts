import { NextRequest, NextResponse } from "next/server";
import { SITE_LOCALE_COOKIE, type SiteLocale } from "./i18n/config";
import { entryLocale } from "./i18n/entry-locale";
import { localePath, localizedHref } from "./i18n/routing";

export const GENERATION_MAINTENANCE_START = Date.parse("2026-11-25T00:00:00Z");
export const GENERATION_MAINTENANCE_END = Date.parse("2026-11-25T05:00:00Z");

export const generationMaintenanceCopy = {
  ko: {
    title: "쇼츠 생성 기능을 점검하고 있습니다",
    detail: "반복되는 영상 생성 오류를 확인하고 있습니다. 11월 25일 오후 2시(한국 시간)까지 신규 쇼츠 생성을 잠시 중단합니다.",
    existing: "기존 프로젝트 열람·편집·다운로드는 계속 이용할 수 있습니다.",
    projects: "내 프로젝트 보기", time: "점검 종료 예정 · 11월 25일 오후 2시 (KST)",
  },
  en: {
    title: "Shorts creation is under maintenance",
    detail: "We are investigating repeated video creation failures. New Shorts creation is temporarily paused until November 25, 2:00 PM Korea Standard Time (05:00 UTC).",
    existing: "You can still view, edit, and download your existing projects.",
    projects: "View my projects", time: "Scheduled end · November 25, 14:00 KST / 05:00 UTC",
  },
  ja: {
    title: "ショート動画の作成機能をメンテナンス中です",
    detail: "動画作成で繰り返し発生しているエラーを調査しています。11月25日14:00（日本時間・韓国時間）まで、新規ショート動画の作成を一時停止します。",
    existing: "既存プロジェクトの閲覧・編集・ダウンロードは引き続きご利用いただけます。",
    projects: "マイプロジェクトを見る", time: "終了予定 · 11月25日 14:00（JST / KST）",
  },
} satisfies Record<SiteLocale, { title: string; detail: string; existing: string; projects: string; time: string }>;

export function generationMaintenanceResponse(request: NextRequest, now = Date.now()): NextResponse | null {
  if (now < GENERATION_MAINTENANCE_START || now >= GENERATION_MAINTENANCE_END) return null;
  const route = localePath(request.nextUrl.pathname);
  const path = route.pathname.replace(/\/$/, "") || "/";
  const page = ["GET", "HEAD"].includes(request.method) && ["/", "/ranking-shorts"].includes(path);
  const api = request.method === "POST" && (
    path === "/api/jobs" || path === "/api/youtube/analyze" || path === "/api/file-upload/sessions"
    || path === "/api/ranking-shorts" || path === "/api/ranking-shorts/discover"
    || /^\/api\/ranking-shorts\/[^/]+\/(render|sources|session)$/.test(path)
    || /^\/api\/ranking-shorts\/[^/]+\/sources\/[^/]+\/preview$/.test(path)
  );
  if (!page && !api) return null;
  let locale = route.prefixed ? route.locale : entryLocale(
    request.cookies.get(SITE_LOCALE_COOKIE)?.value,
    request.headers.get("x-vercel-ip-country"),
    request.headers.get("accept-language"),
  );
  if (api) {
    try {
      const referer = new URL(request.headers.get("referer") || "");
      if (referer.origin === request.nextUrl.origin) locale = localePath(referer.pathname).locale;
    } catch { /* Requests without a page use their language preference. */ }
  }
  const copy = generationMaintenanceCopy[locale];
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "Retry-After": String(Math.max(1, Math.ceil((GENERATION_MAINTENANCE_END - now) / 1000))),
    "Content-Language": locale,
    Vary: "Cookie, Accept-Language, X-Vercel-IP-Country",
  };
  if (api) return NextResponse.json({ detail: copy.detail, code: "GENERATION_MAINTENANCE", endsAt: "2026-11-25T05:00:00Z" }, { status: 503, headers });
  // All interpolated values are fixed application copy or locale-generated paths.
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${copy.title} | EasyCut</title><style>body{margin:0;background:#101010;color:#f5f5f5;font-family:system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}main{max-width:640px;padding:40px 24px}.brand{font-size:24px;font-weight:800;color:#ff735f}.time{color:#ffab84;font-size:14px;margin-top:48px}h1{font-size:clamp(28px,5vw,40px);line-height:1.3;letter-spacing:-.04em}p{line-height:1.8;color:#c5c5c5}.projects{display:inline-block;margin:24px 0;background:#ff755f;color:#161616;padding:14px 22px;border-radius:12px;font-weight:750;text-decoration:none}nav{display:flex;gap:20px;margin-top:24px}nav a{color:#aaa;font-size:14px}</style></head><body><main><div class="brand">EasyCut</div><div class="time">${copy.time}</div><h1>${copy.title}</h1><p>${copy.detail}</p><p>${copy.existing}</p><a class="projects" href="${localizedHref("/projects", locale)}">${copy.projects}</a><nav aria-label="Language"><a href="/">한국어</a><a href="/en">English</a><a href="/jp">日本語</a></nav></main></body></html>`;
  return new NextResponse(request.method === "HEAD" ? null : html, { status: 503, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
