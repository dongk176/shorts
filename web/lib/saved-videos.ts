import { z } from "zod";
import type { PopularVideo } from "@/lib/youtube-popular";

export const MAX_SAVED_VIDEOS = 500;
export const saveVideoSchema = z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }).strict();
export const removeSavedVideoSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type SavedVideo = { id: string; savedAt: string; video: PopularVideo | null };
export const savedVideoCopy = {
  ko: {
    title: "저장된 영상", description: "다시 보고 싶은 영상을 모아두세요. 저장한 순서대로 보여드려요.",
    save: "저장", saved: "저장됨", remove: "저장 해제", saving: "저장 중", removing: "해제 중",
    added: "저장됨", removed: "저장 해제",
    loading: "저장된 영상을 불러오는 중이에요.", error: "저장 목록을 불러오지 못했어요. 다시 시도해 주세요.",
    mutationError: "변경 내용을 저장하지 못했어요. 다시 눌러주세요.", retry: "다시 시도",
    empty: "아직 저장한 영상이 없어요", emptyHint: "실시간 인기에서 마음에 드는 영상의 저장 버튼을 눌러보세요.",
    browse: "실시간 인기 둘러보기", loginTitle: "로그인하고 영상을 모아보세요", loginHint: "내 계정에 저장해서 휴대폰과 컴퓨터에서 이어서 볼 수 있어요.", login: "로그인하기",
    search: "저장한 제목·채널 검색", noResults: "검색어에 맞는 저장 영상이 없어요", clear: "검색 지우기",
    unavailable: "지금은 볼 수 없는 영상이에요", unavailableHint: "비공개·삭제 또는 정보 확인 대기 중일 수 있어요. 저장을 해제할 수 있어요.",
    unavailableSave: "현재 확인할 수 없는 영상이라 저장하지 못했어요.", limit: "최대 500개까지 저장할 수 있어요. 기존 저장을 해제한 뒤 다시 시도해 주세요.",
    more: "더 보기", count: (n: number) => `${n}개 저장`, total: (n: number) => `전체 ${n}개`,
  },
  en: {
    title: "Saved videos", description: "Keep videos worth coming back to. Your latest saves appear first.",
    save: "Save", saved: "Saved", remove: "Unsave", saving: "Saving", removing: "Removing",
    added: "Saved", removed: "Removed from saved videos",
    loading: "Loading your saved videos…", error: "Couldn't load your saved videos. Please try again.",
    mutationError: "Couldn't save that change. Please try again.", retry: "Try again",
    empty: "No saved videos yet", emptyHint: "Find something you like in Trending now and tap Save.",
    browse: "Explore trending videos", loginTitle: "Sign in to save your finds", loginHint: "Save to your account and pick up on your phone or computer.", login: "Sign in",
    search: "Search saved titles or channels", noResults: "No saved videos match your search", clear: "Clear search",
    unavailable: "This video isn't available right now", unavailableHint: "It may be private, deleted, or awaiting a fresh check. You can still remove the bookmark.",
    unavailableSave: "This video isn't available to save right now.", limit: "You can save up to 500 videos. Unsave one and try again.",
    more: "Show more", count: (n: number) => `${n} saved`, total: (n: number) => `${n} total`,
  },
  ja: {
    title: "保存した動画", description: "また見たい動画をまとめておきましょう。新しく保存した順に表示します。",
    save: "保存", saved: "保存済み", remove: "保存を解除", saving: "保存中", removing: "解除中",
    added: "保存しました", removed: "保存を解除しました",
    loading: "保存した動画を読み込んでいます。", error: "保存した動画を読み込めませんでした。もう一度お試しください。",
    mutationError: "変更を保存できませんでした。もう一度お試しください。", retry: "もう一度試す",
    empty: "まだ保存した動画がありません", emptyHint: "人気動画で気になる動画を見つけたら、保存を押してみてください。",
    browse: "人気動画を見てみる", loginTitle: "ログインして動画を保存しましょう", loginHint: "アカウントに保存すれば、スマホでもパソコンでも続きを見られます。", login: "ログイン",
    search: "保存したタイトル・チャンネルを検索", noResults: "検索に合う保存済み動画がありません", clear: "検索をクリア",
    unavailable: "この動画は現在表示できません", unavailableHint: "非公開・削除、または情報の再確認待ちの可能性があります。保存の解除はできます。",
    unavailableSave: "現在確認できない動画のため、保存できませんでした。", limit: "保存できる動画は500件までです。保存を解除してからお試しください。",
    more: "もっと見る", count: (n: number) => `${n}件保存`, total: (n: number) => `全${n}件`,
  },
};
