"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/provider";
import { PlatformIcon } from "./publish-ui";

export type PublishingFeedback = {
  id?: string;
  phase: "sending" | "processing" | "complete" | "failed" | "unknown";
  title: string;
  account?: string;
  detail?: string;
  url?: string;
};

const copy = {
  sending: ["영상을 전송하고 있어요", "Sending your video", "動画を送信しています"],
  processing: ["게시를 마무리하고 있어요", "Finishing your post", "投稿を処理しています"],
  complete: ["업로드 완료!", "Upload complete!", "アップロード完了！"],
  failed: ["업로드하지 못했어요", "Upload failed", "アップロードできませんでした"],
  unknown: ["게시 결과를 확인해 주세요", "Check your post status", "投稿結果を確認してください"],
  sendingHelp: ["전송이 끝날 때까지 이 창을 열어 두세요.", "Keep this window open while we send your video.", "送信が終わるまでこの画面を開いたままにしてください。"],
  processingHelp: ["플랫폼에서 영상을 처리 중입니다. 완료되면 이 화면이 자동으로 바뀝니다.", "The platform is processing your video. This screen will update when it finishes.", "プラットフォームで動画を処理中です。完了すると自動で更新されます。"],
  completeHelp: ["플랫폼에서 업로드 완료를 확인했습니다.", "The platform has confirmed your upload is complete.", "プラットフォームでアップロード完了を確認しました。"],
  failedHelp: ["아래 내용을 확인하고 업로드 설정으로 돌아가 주세요.", "Review the details below, then return to your upload settings.", "下の内容を確認して、投稿設定に戻ってください。"],
  unknownHelp: ["완료 여부를 아직 확인하지 못했습니다. 중복 업로드를 피하려면 먼저 게시 결과를 확인해 주세요.", "We haven't confirmed the result yet. Check the status before posting again to avoid duplicates.", "完了を確認できていません。重複投稿を防ぐため、再投稿前に結果を確認してください。"],
  tiktokHelp: ["나만 보기 영상은 TikTok 앱의 내 프로필 → 자물쇠 탭에서 확인할 수 있어요.", "Find your Only me video in the lock tab on your profile in the TikTok app.", "「自分のみ」の動画はTikTokアプリのプロフィールの鍵タブで確認できます。"],
  transfer: ["영상 전송", "Send video", "動画送信"], process: ["플랫폼 처리", "Processing", "処理"], done: ["완료", "Done", "完了"],
  close: ["닫기", "Close", "閉じる"], back: ["업로드 설정으로 돌아가기", "Back to upload settings", "投稿設定に戻る"],
  check: ["상태 다시 확인", "Check status", "状態を確認"], checking: ["확인 중…", "Checking…", "確認中…"],
  video: ["YouTube에서 영상 보기", "View video on YouTube", "YouTubeで動画を見る"], profile: ["TikTok 프로필 열기", "Open TikTok profile", "TikTokプロフィールを開く"],
  studio: ["YouTube Studio에서 확인", "Check YouTube Studio", "YouTube Studioで確認"],
  post: ["게시물 보기", "View post", "投稿を見る"],
  result: ["게시 결과 보기", "View post status", "投稿結果を見る"],
};
export function publishingText(locale: string, key: keyof typeof copy) { return copy[key][locale === "en" ? 1 : locale === "ja" ? 2 : 0]; }

export function PublishingStatusDialog({ feedback, platform, account, privacy, checking = false, onCheck, onClose }: {
  feedback: PublishingFeedback;
  platform: "YouTube" | "TikTok" | "Instagram" | "Threads";
  account: string;
  privacy: string;
  checking?: boolean;
  onCheck?: () => void;
  onClose: () => void;
}) {
  const { locale } = useI18n(), heading = useId(), description = useId(), dialog = useRef<HTMLDialogElement>(null);
  const t = (key: keyof typeof copy) => publishingText(locale, key);
  const pending = feedback.phase === "sending" || feedback.phase === "processing";
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => { node.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  const step = feedback.phase === "sending" ? 0 : feedback.phase === "complete" ? 2 : 1;
  return createPortal(<dialog ref={dialog} data-i18n-skip className={`publish-status-dialog is-${feedback.phase}`} aria-labelledby={heading} aria-describedby={description}
    onCancel={event => { event.stopPropagation(); if (feedback.phase === "sending") event.preventDefault(); else onClose(); }}
    onClick={event => event.stopPropagation()}>
    <div className="publish-status-brand"><PlatformIcon name={platform}/><span>{platform}</span>{account && <><span>·</span><span>{account}</span></>}</div>
    <div className="publish-status-symbol" aria-hidden="true">{pending ? <span className="publish-status-spinner"/> : feedback.phase === "complete" ? <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="m12 25 8 8 17-18"/></svg> : <span>!</span>}</div>
    <div role="status" aria-live="polite" aria-atomic="true"><h2 id={heading}>{t(feedback.phase)}</h2><p id={description} className="publish-status-description">{t(`${feedback.phase}Help`)}</p></div>
    <div className="publish-status-video"><span data-i18n-content>{feedback.title}</span><small>{privacy}</small></div>
    {(pending || feedback.phase === "complete") && <ol className="publish-status-steps" aria-label={platform}>{(["transfer", "process", "done"] as const).map((key, index) => <li key={key} className={index <= step ? "is-active" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step || feedback.phase === "complete" ? "✓" : index + 1}</span>{t(key)}</li>)}</ol>}
    {feedback.detail && <p className="publish-status-detail">{feedback.detail}</p>}
    {feedback.phase === "complete" && platform === "TikTok" && <p className="publish-status-description">{t("tiktokHelp")}</p>}
    <div className="publish-status-actions">
      {feedback.phase !== "sending" && onCheck && feedback.phase !== "complete" && feedback.phase !== "failed" && <button type="button" className="publish-primary" disabled={checking} onClick={onCheck}>{t(checking ? "checking" : "check")}</button>}
      {platform === "YouTube" && feedback.phase === "unknown" && !feedback.url && <a className="publish-outline" href="https://studio.youtube.com" target="_blank" rel="noreferrer">{t("studio")} ↗</a>}
      {feedback.url && (feedback.phase === "complete" || feedback.phase === "unknown") && <a className="publish-primary" href={feedback.url} target="_blank" rel="noreferrer">{t(platform === "YouTube" ? "video" : platform === "TikTok" ? "profile" : "post")} ↗</a>}
      <button type="button" className={feedback.phase === "failed" || feedback.phase === "complete" && !feedback.url ? "publish-primary" : "publish-outline"} disabled={feedback.phase === "sending"} onClick={onClose}>{t(feedback.phase === "failed" ? "back" : feedback.phase === "complete" ? "done" : "close")}</button>
    </div>
  </dialog>, document.body);
}
