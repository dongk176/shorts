import { type SiteLocale, siteLocales } from "./i18n/config";
import { localePath } from "./i18n/routing";

export const seoBrand = { ko: "이지컷", en: "EasyCut", ja: "EasyCut（イージーカット）" } satisfies Record<SiteLocale, string>;
export const seoDescriptions = {
  ko: "유튜브 링크만 입력하면 AI가 하이라이트를 찾아 30~60초 쇼츠로 자동 편집합니다. 제목과 자막도 한 번에 완성하세요.",
  en: "Turn long YouTube videos into short clips with AI highlights, titles and captions. Review and edit your Shorts before downloading.",
  ja: "YouTubeの長い動画からAIが見どころを選び、タイトル・字幕付きのショート動画を自動作成。切り抜き動画を確認・編集してダウンロードできます。",
} satisfies Record<SiteLocale, string>;

type Copy = { title: string; description: string };
const copy = (title: string, description: string): Copy => ({ title, description });
// Explicit page metadata avoids falling back to Korean when a UI phrase changes.
export const localizedSeoCopy: Record<string, Record<"en" | "ja", Copy>> = {
  "/": {
    en: copy("EasyCut | AI Shorts Maker", seoDescriptions.en),
    ja: copy("EasyCut（イージーカット）| AIショート動画作成", seoDescriptions.ja),
  },
  "/pricing": {
    en: copy("Pricing & Plans | EasyCut", "Compare EasyCut subscriptions and packages, included editing minutes and features. Choose a plan for your Shorts production needs."),
    ja: copy("料金プラン | EasyCut", "EasyCutの月額プランとパッケージを比較。動画の処理時間や利用できる機能を確認し、ショート動画の制作量に合ったプランを選べます。"),
  },
  "/ai-shorts-maker": {
    en: copy("AI Shorts Maker: YouTube to Shorts | EasyCut", "Learn how to turn YouTube videos into Shorts with AI highlight detection, automatic captions and editable titles, from video link to download."),
    ja: copy("AI切り抜き・ショート動画作成 | EasyCut", "YouTube動画からAIで見どころを切り抜き、タイトルと字幕付きのショート動画を作成。リンク入力から編集・ダウンロードまでの使い方をご紹介します。"),
  },
  "/templates": {
    en: copy("Shorts Templates | EasyCut", "Browse EasyCut video templates and preview caption styles and layouts for your Shorts."),
    ja: copy("ショート動画テンプレート | EasyCut", "EasyCutの動画テンプレートを一覧で確認。字幕のスタイルやレイアウトをプレビューして、ショート動画に合うデザインを選べます。"),
  },
  "/popular": {
    en: copy("Trending YouTube Videos | EasyCut", "Explore trending YouTube videos and find ideas for Shorts. Narrow results by category, video length and reuse filters."),
    ja: copy("YouTube急上昇動画 | EasyCut", "今注目されているYouTube動画からショート動画のアイデアを探せます。カテゴリ、動画の長さ、再利用条件のフィルターで絞り込みできます。"),
  },
  "/compare/ai-shorts-tools": {
    en: copy("AI Shorts Tool Comparison | EasyCut", "Compare EasyCut, AlphaCut and FikaClip by their published features, usage allowances, captions, templates and editing options."),
    ja: copy("AIショート動画ツール比較 | EasyCut", "EasyCut・AlphaCut・FikaClipの公開情報をもとに、利用量、字幕、テンプレート、編集機能を比較できます。"),
  },
  "/easycut-private": {
    en: copy("EASYCUT PRIVATE | EasyCut", "Discover the EasyCut community for video recommendations, Shorts production tips and news about new features."),
    ja: copy("EASYCUT PRIVATE | EasyCut", "動画のおすすめ、ショート動画の制作ノウハウ、新機能のお知らせを共有するEasyCutのコミュニティをご紹介します。"),
  },
  "/faq": {
    en: copy("Frequently Asked Questions | EasyCut", "Find answers about EasyCut video requirements, AI highlights, captions, editing and Shorts creation."),
    ja: copy("よくある質問 | EasyCut", "EasyCutで使える動画、AIによる見どころの抽出、字幕、編集、ショート動画作成についてのよくある質問にお答えします。"),
  },
  "/support": {
    en: copy("Customer Support | EasyCut", "Contact EasyCut about using the service, payments, your account or privacy."),
    ja: copy("お問い合わせ | EasyCut", "EasyCutの使い方、お支払い、アカウント、個人情報についてのお問い合わせ窓口をご案内します。"),
  },
  "/terms": {
    en: copy("Terms of Service | EasyCut", "Read the terms governing EasyCut accounts, service use and the rights and responsibilities of users and the operator."),
    ja: copy("利用規約 | EasyCut", "EasyCutのアカウント、サービスの利用条件、利用者と運営者の権利・義務をご確認いただけます。"),
  },
  "/purchase-terms": {
    en: copy("Purchase Terms | EasyCut", "Review the purchase and payment terms for EasyCut subscriptions, packages and additional processing time."),
    ja: copy("購入規約 | EasyCut", "EasyCutの月額プラン、パッケージ、追加処理時間に関する購入・お支払いの条件をご確認いただけます。"),
  },
  "/refund": {
    en: copy("Cancellation & Refund Policy | EasyCut", "Read the cancellation and refund policy for EasyCut paid services and how to contact support about your purchase."),
    ja: copy("キャンセル・返金ポリシー | EasyCut", "EasyCutの有料サービスに関するキャンセル・返金の条件と、購入についてのお問い合わせ方法をご確認いただけます。"),
  },
  "/privacy": {
    en: copy("Privacy Policy | EasyCut", "Learn how Artiroom, the operator of EasyCut, collects, uses and protects personal information and how to contact us about privacy."),
    ja: copy("プライバシーポリシー | EasyCut", "EasyCutを運営するArtiroomによる個人情報の取得・利用・保護と、個人情報に関するお問い合わせ方法をご案内します。"),
  },
  "/guidebook": {
    en: copy("Shorts Channel Guide (Korean Edition) | EasyCut", "Read EasyCut’s eight-page Korean-language guide to choosing a topic and building a focused Shorts channel."),
    ja: copy("ショート動画運営ガイド（韓国語版）| EasyCut", "チャンネルのテーマや動画の題材を選ぶためのEasyCutガイドです。全8ページの本文は韓国語で提供しています。"),
  },
};

export function seoCopyForPath(path: string, locale: SiteLocale): Copy | undefined {
  if (locale === "ko") return undefined;
  return localizedSeoCopy[localePath(path).pathname]?.[locale];
}

const translatedSearchPaths = new Set([
  "/", "/pricing", "/ai-shorts-maker", "/templates", "/popular", "/easycut-private",
  "/compare/ai-shorts-tools", "/faq", "/support", "/terms", "/purchase-terms",
  "/refund", "/privacy", "/shorts-monetization", "/team",
]);

export function searchLocalesForPath(path: string): readonly SiteLocale[] {
  const pathname = localePath(path.split(/[?#]/, 1)[0]).pathname.replace(/\/$/, "") || "/";
  // These originals are readable at localized URLs, but their actual content is Korean.
  // Do not advertise them as translated alternatives or change the visible page.
  if (pathname.includes("/versions/")) return [];
  if (pathname === "/updates" || pathname.startsWith("/updates/")) return siteLocales;
  if (pathname === "/blog" || pathname.startsWith("/blog/") || pathname === "/guidebook"
    || pathname === "/enterprise/purchase-terms" || pathname === "/enterprise/refund-policy") return ["ko"];
  return translatedSearchPaths.has(pathname) ? siteLocales : [];
}
