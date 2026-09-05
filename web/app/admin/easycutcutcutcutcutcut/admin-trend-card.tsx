"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import {
  ADMIN_TREND_LABELS, ADMIN_TREND_PERIODS, clampTrendViewport, trendAxisLabel,
  trendTickIndices, trendValueLabel, trendValueScale, zoomTrendViewport,
  type AdminTrendData, type AdminTrendPeriod, type AdminTrendPoint, type TrendViewport,
} from "@/lib/admin-trends";
import styles from "./admin-shell.module.css";

function money(value: number) {
  return `${value.toLocaleString("ko-KR")}원`;
}

function compactMoney(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}억원`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만원`;
  return money(value);
}

export function AdminTrendCard({ initialData }: { initialData: AdminTrendData }) {
  const [data, setData] = useState(initialData);
  const [pending, setPending] = useState<AdminTrendPeriod | null>(null);
  const [failure, setFailure] = useState<{ period: AdminTrendPeriod; message: string } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const selectId = useId();
  const sales = data.metric === "sales";
  const title = sales ? "매출" : "회원 수 추이";
  const total = data.points.reduce((sum, point) => sum + point.value, 0);

  useEffect(() => () => {
    const request = requestRef.current;
    requestRef.current = null;
    request?.abort();
  }, []);

  async function selectPeriod(period: AdminTrendPeriod) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setFailure(null);
    if (period === data.period) {
      setPending(null);
      return;
    }
    setPending(period);
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`/api/admin/trends?metric=${data.metric}&period=${period}`, {
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? "관리자 로그인을 확인해 주세요." : "그래프를 불러오지 못했습니다.");
      const next = await response.json() as AdminTrendData;
      if (requestRef.current === controller && !controller.signal.aborted) setData(next);
    } catch (error) {
      if (requestRef.current === controller) {
        setFailure({ period, message: controller.signal.aborted
          ? "조회 시간이 초과되었습니다. 다시 시도해 주세요."
          : error instanceof Error ? error.message : "그래프를 불러오지 못했습니다." });
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) setPending(null);
    }
  }

  return (
    <article className={`${styles.analyticsCard} ${sales ? styles.revenueCard : styles.memberCard}`}>
      <div className={styles.cardHeader}>
        <div className={styles.trendHeading}>
          <h3 className={styles.cardTitle}>{title}</h3>
          <label className={styles.trendSrOnly} htmlFor={selectId}>{title} 조회 기간</label>
          <select id={selectId} className={styles.trendSelect} value={pending ?? data.period}
            onChange={(event) => void selectPeriod(event.target.value as AdminTrendPeriod)}>
            {ADMIN_TREND_PERIODS.map((period) => (
              <option key={period} value={period}>{ADMIN_TREND_LABELS[period]}</option>
            ))}
          </select>
        </div>
        <div>
          <p className={styles.chartTotal}>{sales ? "기간 합계" : "기간 신규"}
            <strong>{sales ? compactMoney(total) : `${total.toLocaleString("ko-KR")}명`}</strong>
          </p>
          <p className={styles.chartLegend}>
            <span className={sales ? styles.legendDot : styles.memberLegendDot} />
            {sales ? "일별 매출" : "일별 신규 회원"}
          </p>
        </div>
      </div>
      <div className={styles.trendRequestStatus} role="status">
        {pending ? `${ADMIN_TREND_LABELS[pending]} 불러오는 중…` : null}
        {failure ? <><span>{failure.message}</span>{" "}
          <button type="button" onClick={() => void selectPeriod(failure.period)}>다시 시도</button></> : null}
      </div>
      <div aria-busy={pending !== null} style={{ opacity: pending ? 0.55 : 1 }}>
        <InteractiveTrendChart key={`${data.period}:${data.from}:${data.to}`} data={data} title={title} />
      </div>
    </article>
  );
}

function InteractiveTrendChart({ data, title }: { data: AdminTrendData; title: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const valueAxisRef = useRef<SVGGElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; view: TrendViewport; plotWidth: number; moved: boolean } | null>(null);
  const [width, setWidth] = useState(0);
  const [valueAxisWidth, setValueAxisWidth] = useState(52);
  const [view, setView] = useState<TrendViewport>({ start: 0, count: data.points.length });
  const [active, setActive] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [labelWidths, setLabelWidths] = useState<number[]>([]);
  const gradientId = useId();
  const instructionsId = useId();
  const height = 240;
  const chartWidth = width || 760;
  const padding = { top: 82, right: 4, bottom: 12, left: valueAxisWidth };
  const plotWidth = Math.max(1, chartWidth - padding.left - padding.right);
  const plotBottom = height - padding.bottom;
  const sales = data.metric === "sales";
  const color = sales ? "#9d85ff" : "#56d6b0";
  const lineClass = sales ? styles.chartLine : styles.memberChartLine;
  const pointClass = sales ? styles.chartPoint : styles.memberChartPoint;
  const visible = useMemo(() => data.points.slice(view.start, view.start + view.count), [data.points, view]);
  const valueScale = useMemo(() => trendValueScale(
    visible.reduce((maximum, point) => Math.max(maximum, point.value), 0),
  ), [visible]);
  const includeYear = visible[0]?.date.slice(0, 4) !== visible.at(-1)?.date.slice(0, 4);
  const labels = useMemo(() => visible.map((point) => trendAxisLabel(point.date, includeYear)), [visible, includeYear]);

  useEffect(() => {
    let canceled = false;
    const measure = () => {
      if (canceled || !valueAxisRef.current) return;
      const widths = Array.from(valueAxisRef.current.querySelectorAll("text"), (label) => label.getComputedTextLength());
      setValueAxisWidth(Math.ceil(Math.max(0, ...widths)) + 8);
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => { canceled = true; };
  }, [valueScale, data.metric]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setWidth(frame.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let canceled = false;
    const measure = () => {
      if (canceled || !axisRef.current) return;
      const context = document.createElement("canvas").getContext("2d");
      if (!context) return;
      const computed = getComputedStyle(axisRef.current);
      context.font = `${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
      // Include the CSS letter spacing and a small rounding allowance.
      setLabelWidths(labels.map((label) => Math.ceil(context.measureText(label).width + label.length * 0.12 + 2)));
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => { canceled = true; };
  }, [labels]);

  const coordinates = useMemo(() => {
    return visible.map((point, index) => ({ ...point,
      x: padding.left + (visible.length <= 1 ? plotWidth / 2 : index / (visible.length - 1) * plotWidth),
      y: plotBottom - point.value / valueScale.maximum * (plotBottom - padding.top),
    }));
  }, [visible, valueScale.maximum, plotWidth, plotBottom, padding.left, padding.top]);
  const linePath = useMemo(() => coordinates.map((point, index) =>
    `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "), [coordinates]);
  const areaPath = coordinates.length
    ? `${linePath} L${coordinates[coordinates.length - 1].x},${plotBottom} L${coordinates[0].x},${plotBottom} Z` : "";
  const ticks = width ? trendTickIndices(labels.map((label, index) => Math.max(
    labelWidths[index] ?? 0, label.length * 7,
  )), plotWidth) : [];
  const activePoint = active === null ? null : coordinates[active - view.start];
  const zoomed = view.count < data.points.length;
  const valueLabel = (point: AdminTrendPoint) => sales ? money(point.value) : `${point.value.toLocaleString("ko-KR")}명`;

  function zoom(factor: number) {
    setView((current) => zoomTrendViewport(current, data.points.length, factor));
    setActive(null);
  }

  function reset() {
    setView({ start: 0, count: data.points.length });
    setActive(null);
  }

  function pointerIndex(clientX: number) {
    const left = frameRef.current?.getBoundingClientRect().left ?? 0;
    return view.start + Math.max(0, Math.min(view.count - 1,
      Math.round((clientX - left - padding.left) / plotWidth * (view.count - 1))));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, view, plotWidth, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(pointerIndex(event.clientX));
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) { setActive(pointerIndex(event.clientX)); return; }
    if (drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.x;
    if (Math.abs(delta) > 4) drag.moved = true;
    if (drag.moved && zoomed) {
      setDragging(true);
      setActive(null);
      setView(clampTrendViewport({
        ...drag.view, start: drag.view.start - delta / drag.plotWidth * (drag.view.count - 1),
      }, data.points.length));
    }
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (["+", "=", "-", "Home", "Escape"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Home") reset();
      else if (event.key === "Escape") setActive(null);
      else zoom(event.key === "-" ? 2 : 0.5);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = Math.max(0, Math.min(data.points.length - 1,
      (active ?? view.start) + (event.key === "ArrowLeft" ? -1 : 1)));
    setActive(next);
    if (next < view.start || next >= view.start + view.count) {
      setView(clampTrendViewport({ ...view, start: next < view.start ? next : next - view.count + 1 }, data.points.length));
    }
  }

  return (
    <>
      <div className={styles.trendToolbar}>
        <span className={styles.trendVisibleRange}>현재 보기 {visible[0]?.date.replaceAll("-", ".")} – {visible.at(-1)?.date.replaceAll("-", ".")}</span>
        <div className={styles.trendButtons} role="group" aria-label={`${title} 확대 및 축소`}>
          <button type="button" aria-label={`${title} 확대`} disabled={view.count <= 2} onClick={() => zoom(0.5)}>＋</button>
          <button type="button" aria-label={`${title} 축소`} disabled={!zoomed} onClick={() => zoom(2)}>−</button>
          <button type="button" disabled={!zoomed} onClick={reset}>전체 보기</button>
        </div>
      </div>
      <div ref={frameRef} className={`${styles.chartFrame} ${styles.trendInteractive}`}
        style={{ cursor: zoomed ? dragging ? "grabbing" : "grab" : "crosshair" }}
        role="group" aria-label={`${ADMIN_TREND_LABELS[data.period]} 일별 ${title}`}
        aria-describedby={instructionsId} tabIndex={0}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch" && !dragRef.current) setActive(null);
        }}
        onFocus={(event) => {
          // Pointer focus must preserve the date selected by a tap or click.
          if (event.currentTarget.matches(":focus-visible")) setActive(view.start);
        }} onBlur={() => setActive(null)} onKeyDown={keyDown}>
        <svg className={styles.chart} style={{ height }} viewBox={`0 0 ${chartWidth} ${height}`} aria-hidden="true">
          <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.27" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient></defs>
          <g ref={valueAxisRef}>{valueScale.ticks.map((value) => {
            const y = plotBottom - value / valueScale.maximum * (plotBottom - padding.top);
            return <g key={value}>
              <line className={styles.chartGrid} x1={padding.left} x2={chartWidth - padding.right} y1={y} y2={y} />
              <text className={styles.trendValueTick} x={0} y={y} textAnchor="start" dominantBaseline="middle">
                {trendValueLabel(value, data.metric)}
              </text>
            </g>;
          })}</g>
          {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
          {linePath ? <path className={lineClass} d={linePath} /> : null}
          {plotWidth / Math.max(1, visible.length - 1) >= 12 ? coordinates.map((point) => (
            <circle key={point.date} className={pointClass} cx={point.x} cy={point.y} r="3.2" />
          )) : null}
          {activePoint ? <>
            <line x1={activePoint.x} x2={activePoint.x} y1={padding.top} y2={plotBottom} stroke={color} strokeOpacity="0.4" strokeDasharray="3 3" />
            <circle className={pointClass} cx={activePoint.x} cy={activePoint.y} r="5" />
          </> : null}
        </svg>
        {activePoint ? <div className={styles.trendTooltip} style={{
          left: Math.max(96, Math.min(chartWidth - 96, activePoint.x)),
        }}>
          <span className={styles.chartTooltipDate}>{activePoint.date.replaceAll("-", ".")}</span>
          <strong>{valueLabel(activePoint)}</strong>
          <span className={styles.chartTooltipDetail}>{sales ? `${activePoint.orderCount?.toLocaleString("ko-KR") ?? 0}건 승인` : "신규 가입"}</span>
        </div> : null}
        <div ref={axisRef} className={styles.chartDateLabels} aria-hidden="true">
          {ticks.map((index) => <span key={visible[index].date}
            className={`${styles.chartDateLabel} ${index === 0 && visible.length > 1 ? styles.chartDateLabelFirst : index === visible.length - 1 && visible.length > 1 ? styles.chartDateLabelLast : ""}`}
            style={{ "--chart-date-position": `${coordinates[index].x / chartWidth * 100}%` } as CSSProperties}>
            {labels[index]}
          </span>)}
        </div>
        <span className={styles.trendSrOnly} aria-live="polite">
          {activePoint ? `${activePoint.date} ${valueLabel(activePoint)}${sales ? ` ${activePoint.orderCount ?? 0}건 승인` : " 신규 가입"}` : ""}
        </span>
      </div>
      <p className={styles.trendHint} id={instructionsId}>＋로 확대 · 좌우 드래그로 이동<span className={styles.trendSrOnly}> · 현재 Y축 범위 {trendValueLabel(0, data.metric)}부터 {trendValueLabel(valueScale.maximum, data.metric)} · 방향키로 날짜 확인 · ＋, −로 확대 및 축소 · Home으로 전체 보기</span></p>
    </>
  );
}
