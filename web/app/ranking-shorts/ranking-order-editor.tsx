"use client";

import { useEffect, useId, useRef, useState } from "react";
import { moveRankingRank, shuffleRankingOrder } from "@/lib/ranking-order";

type OrderProps = {
  order: number[];
  labels: string[];
  onChange: (order: number[]) => void;
};

export function RankingOrderControls({ order, labels, onChange }: OrderProps) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ rank: number; target: number } | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const descending = order.every(
    (rank, index) => rank === order.length - index,
  );
  const ascending = order.every((rank, index) => rank === index + 1);
  function clearDrag() {
    drag.current = null;
    setTarget(null);
  }
  return (
    <div ref={container} className="ranking-order-compact">
      <div className="ranking-order-presets">
        <button
          type="button"
          aria-pressed={descending}
          onClick={() => onChange([...order].sort((a, b) => b - a))}
        >
          {order.length} → 1
        </button>
        <button
          type="button"
          aria-pressed={ascending}
          onClick={() => onChange([...order].sort((a, b) => a - b))}
        >
          1 → {order.length}
        </button>
        <button
          type="button"
          onClick={() => onChange(shuffleRankingOrder(order))}
        >
          랜덤
        </button>
      </div>
      <ol className="ranking-order-chips" aria-label="재생 순서 목록">
        {order.map((rank, index) => (
          <li key={rank}>
            <button
              type="button"
              data-order-rank={rank}
              className={target === rank ? "is-target" : ""}
              aria-label={`${rank}위 순서 이동`}
              title={
                labels[rank - 1] || `${rank}위 · 드래그하거나 방향키로 이동`
              }
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                drag.current = { rank, target: rank };
                setTarget(rank);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (drag.current?.rank !== rank) return;
                const chip = document
                  .elementFromPoint(event.clientX, event.clientY)
                  ?.closest<HTMLElement>("[data-order-rank]");
                if (chip && container.current?.contains(chip)) {
                  const value = Number(chip.dataset.orderRank);
                  drag.current.target = value;
                  setTarget(value);
                }
              }}
              onPointerUp={(event) => {
                if (drag.current?.rank === rank && drag.current.target !== rank)
                  onChange(moveRankingRank(order, rank, drag.current.target));
                clearDrag();
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={clearDrag}
              onLostPointerCapture={clearDrag}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  index +
                  (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
                if (order[next])
                  onChange(moveRankingRank(order, rank, order[next]));
              }}
            >
              {rank}
              <small>위</small>
            </button>
            {index < order.length - 1 ? (
              <span aria-hidden="true">›</span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="ranking-order-hint">드래그해서 순서 변경</p>
    </div>
  );
}

export function RankingOrderEditor({
  onClose,
  ...props
}: OrderProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="ranking-order-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="ranking-sheet-grip" aria-hidden="true" />
      <header>
        <h2 id={titleId}>재생 순서</h2>
        <button type="button" aria-label="재생 순서 닫기" onClick={onClose}>
          ×
        </button>
      </header>
      <RankingOrderControls {...props} />
    </dialog>
  );
}
