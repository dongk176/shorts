"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from "react";
import { defaultRankingFraming, normalizeRankingFraming, rankingFramingGeometry, type RankingFraming } from "@/lib/ranking-framing";
import { analyzeRankingBackground } from "@/lib/ranking-auto-framing";
import { rankingTime } from "@/lib/ranking-shorts";

export function RankingFramingEditor({ width, height, value, onChange, children, playing, ready, time, onToggle, analysisUrl, start = 0, end = 0 }: {
  width: number; height: number; value?: RankingFraming; onChange: (value: RankingFraming) => void;
  children: ReactNode; playing: boolean; ready: boolean; time: number; onToggle: () => void;
  analysisUrl?: string; start?: number; end?: number;
}) {
  const [open, setOpen] = useState(false);
  const baseline = useRef(defaultRankingFraming);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; height: number; value: RankingFraming; kind: "top" | "bottom" | "pan" } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const analysisKey = `${analysisUrl ?? ""}:${start}:${end}`;
  const [analysis, setAnalysis] = useState<{ key: string; pending: boolean; message: string; undo?: RankingFraming }>({ key: "", pending: false, message: "" });
  const analyzing = analysis.key === analysisKey && analysis.pending;
  const status = analysis.key === analysisKey ? analysis : null;
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, [analysisUrl, start, end]);
  const framing = normalizeRankingFraming(value);
  const latestFraming = useRef(framing);
  latestFraming.current = framing;
  const geometry = rankingFramingGeometry(width, height, framing);
  const changed = framing.top > 0 || framing.bottom > 0 || framing.zoom !== 1 || framing.panY !== 0;
  function stopAnalysis() {
    controller.current?.abort(); controller.current = null;
    setAnalysis(previous => ({ ...previous, pending: false, message: previous.pending ? "" : previous.message }));
  }
  function cancel() { stopAnalysis(); onChange(baseline.current); setAnalysis({key:analysisKey,pending:false,message:""}); setOpen(false); }
  async function autoFind() {
    if (!analysisUrl || analyzing) return;
    stopAnalysis();
    const request = new AbortController(); controller.current = request;
    const previous = framing;
    if (!open) { baseline.current = framing; setOpen(true); }
    setAnalysis({key:analysisKey,pending:true,message:"선택한 구간에서 영상 영역을 찾고 있어요…"});
    try {
      const edges = await analyzeRankingBackground(analysisUrl, start, end, request.signal);
      if (controller.current !== request || request.signal.aborted) return;
      if (JSON.stringify(latestFraming.current) !== JSON.stringify(previous)) {
        setAnalysis({key:analysisKey,pending:false,message:"화면 조정이 바뀌었어요. 다시 눌러 주세요."}); return;
      }
      if (!edges) { setAnalysis({key:analysisKey,pending:false,message:"뚜렷한 상하 배경을 찾지 못했어요. 손잡이로 직접 조절해 주세요."}); return; }
      onChange({...previous,...edges});
      setAnalysis({key:analysisKey,pending:false,message:"상하 배경을 찾았어요. 필요하면 손잡이로 조절하세요.",undo:previous});
    } catch (error) {
      if (controller.current !== request || request.signal.aborted) return;
      setAnalysis({key:analysisKey,pending:false,message:error instanceof Error ? error.message : "분석하지 못했어요. 직접 조절해 주세요."});
    } finally { if (controller.current === request) controller.current = null; }
  }
  function begin(event: PointerEvent<HTMLElement>, kind: "top" | "bottom" | "pan") {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, y: event.clientY, height: stage.current!.getBoundingClientRect().height, value: framing, kind };
  }
  function move(event: PointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || state.id !== event.pointerId || !state.height) return;
    const delta = (event.clientY - state.y) / state.height;
    if (state.kind === "pan") {
      const travel = rankingFramingGeometry(width, height, state.value).travel;
      if (travel > .0001) onChange(normalizeRankingFraming({ ...state.value, panY: state.value.panY - 2 * delta / travel }));
    } else if (state.kind === "top") {
      onChange(normalizeRankingFraming({ ...state.value, top: Math.min(.8 - state.value.bottom, state.value.top + delta) }));
    } else onChange(normalizeRankingFraming({ ...state.value, bottom: Math.min(.8 - state.value.top, state.value.bottom - delta) }));
  }
  const pointerHandlers = { onPointerMove: move, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; } };
  return <section className={`ranking-framing-editor${open ? " is-editing" : ""}`} aria-label="영상 화면 조정" onKeyDown={event => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
    <div className="ranking-framing-toolbar">
      <span>{open ? "남길 영역을 조절하세요" : "원본 영상"}</span>
      <div className="ranking-framing-actions">
      <button type="button" className="ranking-framing-auto" onClick={() => void autoFind()} disabled={!analysisUrl || !ready || analyzing}
        title={!analysisUrl ? "유튜브는 다운로드 없이 손잡이로 직접 조절해 주세요." : "선택 구간의 상하 배경을 찾습니다. 확대와 위치는 바뀌지 않아요."}>
        {analyzing ? <span className="ranking-spinner" aria-hidden="true" /> : <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7V3h4m6 0h4v4m0 6v4h-4m-6 0H3v-4M10 6v8M6 10h8" strokeLinecap="round" /></svg>}
        {analyzing ? "분석 중…" : "영상 영역 자동 찾기"}
      </button>
      <button type="button" className="ranking-framing-trigger" aria-expanded={open} onClick={() => {
        if (open) { stopAnalysis(); setOpen(false); return; }
        baseline.current = framing; setOpen(true);
      }}><svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true"><path d="M5 2v11a2 2 0 0 0 2 2h11M2 5h11a2 2 0 0 1 2 2v11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>화면 조정{!open && changed ? <i aria-label="조정됨" /> : null}</button>
      </div>
    </div>
    {status?.message ? <div className="ranking-framing-analysis" role="status" aria-live="polite" aria-busy={analyzing}><span>{status.message}</span>{status.undo ? <button type="button" onClick={() => { onChange(status.undo!); setAnalysis({key:analysisKey,pending:false,message:"이전 화면 조정으로 되돌렸어요."}); }}>되돌리기</button> : null}</div> : null}
    <div ref={stage} className="ranking-framing-stage" style={{ aspectRatio: width > 0 && height > 0 ? width / height : 9 / 16, "--ranking-framing-aspect": width > 0 && height > 0 ? width / height : 9 / 16 } as CSSProperties}>
      {children}
      {open ? <div className="ranking-framing-guides">
        <div className="ranking-framing-shade is-top" style={{ height: `${framing.top * 100}%` }} />
        <div className="ranking-framing-shade is-bottom" style={{ height: `${framing.bottom * 100}%` }} />
        <div className="ranking-framing-viewport" role="slider" aria-orientation="vertical" tabIndex={0} aria-label="영상 세로 위치" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(framing.panY * 100)}
          style={{ left: `${geometry.viewport.left * 100}%`, top: `${geometry.viewport.top * 100}%`, width: `${geometry.viewport.width * 100}%`, height: `${geometry.viewport.height * 100}%` }}
          onPointerDown={event => begin(event, "pan")} {...pointerHandlers}
          onKeyDown={event => { if (["ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); onChange(normalizeRankingFraming({ ...framing, panY: framing.panY + (event.key === "ArrowUp" ? .05 : -.05) })); } }}>
          <span className="ranking-framing-grid" /><span className="ranking-framing-position-label">위치 이동 <b aria-hidden="true">↕</b></span>
        </div>
        {(["top", "bottom"] as const).map(edge => <div key={edge} className={`ranking-framing-handle is-${edge}`} role="slider" aria-orientation="vertical" tabIndex={0}
          aria-label={edge === "top" ? "위쪽 자르기" : "아래쪽 자르기"} aria-valuemin={0} aria-valuemax={Math.min(60, Math.round((.8 - framing[edge === "top" ? "bottom" : "top"]) * 100))} aria-valuenow={Math.round(framing[edge] * 100)}
          style={{ top: `${(edge === "top" ? framing.top : 1 - framing.bottom) * 100}%` }}
          onPointerDown={event => begin(event, edge)} {...pointerHandlers}
          onKeyDown={event => {
            if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
            event.preventDefault(); const direction = event.key === "ArrowDown" ? 1 : -1;
            const next = event.key === "Home" ? 0 : framing[edge] + .01 * direction * (edge === "top" ? 1 : -1);
            onChange(normalizeRankingFraming({ ...framing, [edge]: Math.min(.8 - framing[edge === "top" ? "bottom" : "top"], next) }));
          }}><i /></div>)}
      </div> : null}
    </div>
    <div className="ranking-source-transport"><button type="button" onClick={onToggle} disabled={!ready} aria-label={playing ? "원본 영상 일시 정지" : "원본 영상 재생"}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{playing ? <path fill="currentColor" d="M7 5h4v14H7zm6 0h4v14h-4z" /> : <path fill="currentColor" d="m9 5 11 7-11 7z" />}</svg>
    </button><span>{rankingTime(time)}</span><span className="ranking-framing-result-hint">{open ? "자른 자리는 검정으로 남아요" : ""}</span></div>
    {open ? <div className="ranking-framing-settings">
      <label>확대<input aria-label="영상 확대" type="range" min="1" max="2.5" step=".01" value={framing.zoom} onChange={event => onChange({ ...framing, zoom: Number(event.target.value) })} /><output>{framing.zoom.toFixed(2)}×</output></label>
      <div className="ranking-framing-footer"><button type="button" onClick={() => { stopAnalysis(); setAnalysis({key:analysisKey,pending:false,message:""}); onChange(defaultRankingFraming); }}>초기화</button><div><button type="button" onClick={cancel}>취소</button><button type="button" className="is-primary" disabled={analyzing} onClick={() => setOpen(false)}>완료</button></div></div>
    </div> : null}
  </section>;
}
