"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SiteLocale } from "@/lib/i18n/config";
import { cancellationFeedbackSchema, cancellationReasons, type CancellationFeedback } from "@/lib/subscription-cancellation";

const copy = {
  ko: {
    title: "떠나시는 이유를 알려주세요", description: "더 나은 이지컷을 위해 해지 사유를 하나 선택해 주세요.",
    reasons: ["가격이 부담돼요", "사용할 일이 줄었어요", "영상 결과가 만족스럽지 않아요", "필요한 기능이 없어요", "오류·처리 속도가 불편해요", "다른 서비스를 이용할 예정이에요", "기타"],
    other: "해지 사유 (필수)", detail: "운영진에게 전하고 싶은 말 (선택)", service: "이용할 서비스명 (선택)", undecided: "아직 정하지 않았어요", keep: "구독 유지", next: "다음", back: "이전", confirm: "해지 확정", busy: "처리 중…", step: ["1 / 2 · 해지 사유", "2 / 2 · 최종 확인"], summary: "선택한 해지 사유", privacy: "답변은 서비스 개선을 위해 저장됩니다. 개인정보나 결제정보는 적지 말아 주세요.",
    hints: ["다른 요금제가 더 적합한지 요금제 관리에서 살펴볼 수 있어요.", "이용이 다시 필요해지면 요금제 페이지에서 구독할 수 있어요.", "불편했던 결과를 고객지원에 알려주시면 개선에 도움이 됩니다.", "필요했던 기능을 추가 의견으로 남겨주시면 개선에 참고하겠습니다.", "오류나 속도 문제는 고객지원으로 문의하실 수 있어요.", "다른 서비스를 선택한 이유도 개선에 참고하겠습니다.", "남겨주신 의견을 서비스 개선에 참고하겠습니다."],
  },
  en: {
    title: "Why are you leaving?", description: "Please choose one reason to help us improve EasyCut.",
    reasons: ["Too expensive", "I use it less often", "Unsatisfied with video results", "Missing features", "Errors or slow processing", "Moving to another service", "Other"],
    other: "Reason (required)", detail: "A message to the team (optional)", service: "Service name (optional)", undecided: "I haven't decided yet", keep: "Keep subscription", next: "Next", back: "Back", confirm: "Confirm cancellation", busy: "Processing…", step: ["1 / 2 · Reason", "2 / 2 · Confirmation"], summary: "Your reason", privacy: "Answers are saved to improve the service. Please do not include personal or payment information.",
    hints: ["You can explore other plans in billing management.", "You can subscribe again on the pricing page when you need us.", "Sharing unsatisfactory results with support helps us improve.", "Tell us which features you need in your feedback.", "You can contact support about errors or processing speed.", "Your feedback will help us understand your choice.", "We will use your feedback to improve the service."],
  },
  ja: {
    title: "解約の理由を教えてください", description: "EasyCutの改善のため、理由を1つ選んでください。",
    reasons: ["料金が高い", "利用する機会が減った", "動画の仕上がりに不満がある", "必要な機能がない", "エラー・処理速度が気になる", "他のサービスを利用する予定", "その他"],
    other: "解約理由（必須）", detail: "運営チームへのメッセージ（任意）", service: "サービス名（任意）", undecided: "まだ決めていません", keep: "契約を継続", next: "次へ", back: "戻る", confirm: "解約を確定", busy: "処理中…", step: ["1 / 2 · 解約理由", "2 / 2 · 最終確認"], summary: "選択した理由", privacy: "回答はサービス改善のために保存されます。個人情報や決済情報は入力しないでください。",
    hints: ["契約管理で他のプランを確認できます。", "必要になったら料金ページから再契約できます。", "仕上がりへのご意見はサポートにお知らせください。", "必要な機能を追加のご意見にご記入ください。", "エラーや処理速度はサポートにお問い合わせください。", "サービス選びについてのご意見を改善に活かします。", "いただいたご意見をサービス改善に活かします。"],
  },
};

export function SubscriptionCancellationDialog({ locale, title, children, busy, error, onClose, onConfirm }: {
  locale: SiteLocale; title: string; children: ReactNode; busy: boolean; error: string | null;
  onClose: () => void; onConfirm: (feedback: CancellationFeedback) => void;
}) {
  const t = copy[locale];
  const [step, setStep] = useState(0);
  const [reason, setReason] = useState<CancellationFeedback["reason"] | "">("");
  const [message, setMessage] = useState("");
  const [detail, setDetail] = useState("");
  const [alternativeService, setAlternativeService] = useState("");
  const [alternativeUndecided, setAlternativeUndecided] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = cancellationFeedbackSchema.safeParse({ reason, detail: reason === "other" ? detail : "", message, alternativeService, alternativeUndecided });
  const index = cancellationReasons.findIndex((value) => value === reason);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    heading.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step]);
  return <div className="fixed inset-0 z-[160] grid place-items-center overflow-y-auto bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="cancellation-survey-title" aria-describedby="cancellation-survey-description" aria-busy={busy}
      className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[22px] border border-white/[.14] bg-[#232526] p-5 shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:p-6"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
        if (event.key !== "Tab") return;
        const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]');
        if (!items?.length) { event.preventDefault(); return; }
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <p className="mb-3 text-xs font-bold text-neutral-400">{t.step[step]}</p>
      <h2 ref={heading} tabIndex={-1} id="cancellation-survey-title" className="text-xl font-black text-white outline-none">{step === 0 ? t.title : title}</h2>
      {step === 0 ? <>
        <p id="cancellation-survey-description" className="mt-2 text-sm leading-6 text-neutral-400">{t.description}</p>
        <fieldset className="mt-5 space-y-2" disabled={busy}>
          <legend className="sr-only">{t.description}</legend>
          {cancellationReasons.map((value, i) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm ${reason === value ? "border-[#ff715e] bg-[#ff715e]/10 text-white" : "border-white/10 text-neutral-300"}`}>
            <input type="radio" name="cancellation-reason" value={value} checked={reason === value} required onChange={() => { setReason(value); setAlternativeService(""); setAlternativeUndecided(false); }} className="accent-[#ff715e]" />{t.reasons[i]}
          </label>)}
        </fieldset>
        {reason === "alternative" && <div className="mt-4 space-y-3">
          <label className="block text-sm text-neutral-300">{t.service}<input type="text" maxLength={100} value={alternativeService} disabled={busy || alternativeUndecided} onChange={(e) => setAlternativeService(e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-black/20 p-3 text-white disabled:opacity-40" /></label>
          <label className="flex items-center gap-2 text-sm text-neutral-300"><input type="checkbox" checked={alternativeUndecided} disabled={busy} onChange={(e) => { setAlternativeUndecided(e.target.checked); setAlternativeService(""); }} />{t.undecided}</label>
        </div>}
        {reason === "other" && <label className="mt-4 block text-sm text-neutral-300">{t.other}<textarea required={reason === "other"} maxLength={1000} rows={3} value={detail} disabled={busy} onChange={(e) => setDetail(e.target.value)} className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-black/20 p-3 text-white" /></label>}
        <label className="mt-4 block text-sm text-neutral-300">{t.detail}<textarea maxLength={2000} rows={3} value={message} disabled={busy} onChange={(e) => setMessage(e.target.value)} className="mt-2 w-full resize-y rounded-xl border border-white/15 bg-black/20 p-3 text-white" /></label>
        <p className="mt-3 text-xs leading-5 text-neutral-500">{t.privacy}</p>
      </> : <>
        <div id="cancellation-survey-description" className="mt-3 text-sm leading-7 text-neutral-300">{children}</div>
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[.03] p-4 text-sm"><p className="text-xs text-neutral-500">{t.summary}</p><p className="mt-1 text-white">{t.reasons[index]}</p><p className="mt-2 leading-6 text-neutral-400">{t.hints[index]}</p></div>
      </>}
      {error && <p role="alert" className="mt-4 text-sm text-red-200">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={busy} onClick={step === 0 ? onClose : () => setStep(0)} className="min-h-11 rounded-xl border border-white/15 px-4 text-sm font-bold disabled:opacity-40">{step === 0 ? t.keep : t.back}</button>
        <button type="button" disabled={busy || !feedback.success} onClick={() => { if (!feedback.success) return; if (step === 0) setStep(1); else onConfirm(feedback.data); }} className="min-h-11 rounded-xl bg-[#ff715e] px-5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? t.busy : step === 0 ? t.next : t.confirm}</button>
      </div>
    </section>
  </div>;
}
