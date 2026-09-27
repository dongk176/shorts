"use client";

import Link from "@/lib/i18n/navigation";
import { useI18n } from "@/lib/i18n/provider";
import { textFor } from "@/lib/shorts-guides/catalog";

export function StrategyGuideBenefit() {
  const { locale } = useI18n();
  return (
    <aside
      className="mx-auto mb-10 max-w-5xl rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
      data-i18n-skip
    >
      <p className="text-sm font-semibold text-violet-300">
        {textFor(
          [
            "유료 플랜에 함께 담았어요",
            "Included with your paid plan",
            "有料プランに含まれています",
          ],
          locale,
        )}
      </p>
      <h2 className="mt-2 text-xl font-semibold text-white">
        {textFor(
          [
            "내 쇼츠에 바로 써먹는 실행북 5권",
            "5 workbooks to put your Shorts plan into practice",
            "ショート制作にすぐ使える実践ブック5冊",
          ],
          locale,
        )}
      </h2>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-300">
        {textFor(
          [
            "첫 쇼츠부터 제휴 수익, 채널 운영, 브랜드 협업, 내 상품 판매까지. 이지컷 실습과 작성 과제가 담긴 PDF를 유료 플랜 이용 기간에 내려받을 수 있어요. 기존 패키지 전자책과는 별도 구성입니다.",
            "From your first Short to affiliate content, channel growth, brand collaborations and selling your own offer. Download these PDFs, with EasyCut exercises and worksheets, while your paid plan is active. This collection is separate from the existing package ebooks.",
            "最初のショートから、アフィリエイト、チャンネル運営、企業案件、自分の商品販売まで。EasyCutの実習とワークシート入りPDFを、有料プランの有効期間中にダウンロードできます。従来のパッケージ電子書籍とは別の内容です。",
          ],
          locale,
        )}
      </p>
      <Link
        href="/shorts-monetization#guide-library"
        prefetch={false}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-violet-300 underline underline-offset-4"
      >
        {textFor(
          [
            "목차와 본문 미리 보기",
            "Browse the contents and sample pages",
            "目次と本文サンプルを見る",
          ],
          locale,
        )}
      </Link>
    </aside>
  );
}
