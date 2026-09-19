"use client";

import { localizedHref } from "@/lib/i18n/routing";
import { useI18n } from "@/lib/i18n/provider";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none">
      <path fill="#191919" d="M12 3C6.477 3 2 6.57 2 10.975c0 2.857 1.879 5.362 4.703 6.772l-.956 3.503c-.085.31.27.557.54.376l4.19-2.793c.496.077 1.005.117 1.523.117 5.523 0 10-3.57 10-7.975S17.523 3 12 3Z" />
    </svg>
  );
}

const loginProviders = [
  { id: "google", labelKey: "auth.google", Icon: GoogleIcon, className: "bg-white text-[#171717] hover:bg-[#f3f3f3]" },
  { id: "kakao", labelKey: "auth.kakao", Icon: KakaoIcon, className: "bg-[#FEE500] text-[#191919] hover:bg-[#f4dc00]" },
] as const;

export function SocialLoginButtons({ next, labels }: {
  next: string;
  labels?: { google: string; kakao: string };
}) {
  const { t, locale } = useI18n();
  return loginProviders.map((provider) => {
    const className = `flex min-h-14 w-full items-center justify-center gap-3 rounded-xl px-5 text-[15px] font-bold shadow-[0_6px_18px_rgba(0,0,0,.16)] transition duration-200 active:scale-[.98] ${provider.className}`;
    const content = <><provider.Icon />{labels?.[provider.id] ?? t(provider.labelKey)}</>;
    return <a key={provider.id} href={`/auth/sign-in?provider=${provider.id}&next=${encodeURIComponent(localizedHref(next, locale))}`} className={className}>{content}</a>;
  });
}
