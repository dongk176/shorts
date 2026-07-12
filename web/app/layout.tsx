import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Easy Cut — YouTube to Shorts",
  description: "유튜브 영상의 핵심 구간을 찾아 세로 쇼츠를 자동으로 생성합니다.",
  icons: {
    icon: "/east-cut-logo.png",
    shortcut: "/east-cut-logo.png",
    apple: "/east-cut-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
