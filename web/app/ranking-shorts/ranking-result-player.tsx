"use client";
import { useEffect, useRef, useState } from "react";

const ratings = [["good", "좋아요"], ["okay", "보통이에요"], ["poor", "아쉬워요"]] as const;
type Rating = typeof ratings[number][0];

export function RankingResultPlayer({ url }: { url: string }) {
  // Reset all playback and response state when a different render is opened.
  return <ResultPlayer key={url} url={url} />;
}
function ResultPlayer({ url }: { url: string }) {
  const match = url.match(/\/api\/ranking-shorts\/([^/]+)\/media\/([^?]+)/);
  const endpoint = match ? `/api/ranking-shorts/${match[1]}/feedback` : null;
  const operationId = match?.[2];
  const [viewed, setViewed] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!viewed || !endpoint || !operationId) return;
    const controller = new AbortController();
    void fetch(`${endpoint}?operation=${operationId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted) setEligible(data.handled === false); })
      .catch(() => { /* Feedback must never interrupt result playback. */ });
    return () => controller.abort();
  }, [viewed, endpoint, operationId]);
  async function submit(dismiss = false) {
    if (!endpoint || (!dismiss && !rating) || submitting.current) return;
    submitting.current = true; setSaving(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId, rating: dismiss ? null : rating, comment: dismiss ? "" : comment }) });
      if (!response.ok) throw Error();
      if (mounted.current) { setEligible(false); setSaved(!dismiss); }
    } catch { if (mounted.current) setError("의견을 저장하지 못했어요. 다시 시도해 주세요."); }
    finally { submitting.current = false; if (mounted.current) setSaving(false); }
  }
  return <>
    <video controls playsInline src={url} aria-label="완성된 랭킹 쇼츠"
      onTimeUpdate={event => { if (!event.currentTarget.paused && event.currentTarget.currentTime >= 3) setViewed(true); }}
      onEnded={() => setViewed(true)} />
    {eligible && <section className="ranking-result-feedback" aria-label="랭킹 쇼츠 평가">
      <div className="ranking-feedback-heading"><h3>만들어진 영상은 어땠나요?</h3><button type="button" disabled={saving} onClick={() => void submit(true)}>건너뛰기</button></div>
      <div className="ranking-feedback-ratings" role="group" aria-label="영상 만족도">
        {ratings.map(([value, label]) => <button key={value} type="button" aria-pressed={rating === value} disabled={saving} onClick={() => setRating(value)}>{label}</button>)}
      </div>
      {rating && <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor={`ranking-feedback-${operationId}`}>더 나아졌으면 하는 점이 있나요? <span>(선택)</span></label>
        <textarea id={`ranking-feedback-${operationId}`} value={comment} onChange={event => setComment(event.target.value)} maxLength={1000} rows={2} disabled={saving} placeholder="편하게 남겨 주세요." />
        <button type="submit" disabled={saving} className="ranking-feedback-submit">{saving ? "보내는 중…" : "의견 보내기"}</button>
      </form>}
      {error && <p role="alert">{error}</p>}
    </section>}
    {saved && <p className="ranking-feedback-thanks" role="status">의견 감사합니다. 더 좋은 랭킹 쇼츠로 개선할게요.</p>}
  </>;
}
