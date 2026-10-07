"use client";

import { useEffect, useId, useState } from "react";
import { useUiText } from "@/lib/i18n/use-ui-text";
import { adjustTimedRange, COMMENT_RANGE_MIN_SECONDS } from "@/lib/range-editing";

type Range = { startSeconds: number; endSeconds: number };
const secondsText = (seconds: number) => String(Math.round(seconds * 1000) / 1000);

function TimeField({ label, value, minimum, maximum, selected, onSelect, onChange }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  selected: boolean;
  onSelect: () => void;
  onChange: (value: number) => void;
}) {
  const ui = useUiText();
  const inputId = useId();
  const [draft, setDraft] = useState(secondsText(value));
  useEffect(() => setDraft(secondsText(value)), [value]);
  const commit = (text: string) => {
    const next = Number(text);
    if (text.trim() && Number.isFinite(next) && text.trim() !== secondsText(value)) onChange(next);
    setDraft(secondsText(value));
  };
  return <div className={`editor-time-field${selected ? " is-selected" : ""}`}>
    <label htmlFor={inputId}>{ui(label)}</label>
    <div className="editor-time-value">
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        aria-label={ui(`${label} (초)`)}
        min={minimum}
        max={maximum}
        step="0.1"
        value={draft}
        onFocus={onSelect}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = secondsText(value);
            setDraft(secondsText(value));
            event.currentTarget.blur();
          }
        }}
      />
      <span aria-hidden="true">{ui("초")}</span>
    </div>
  </div>;
}

export function EditorTimingControls({ range, durationSeconds, previousEndSeconds = 0, nextStartSeconds = durationSeconds, onChange, onInteractionStart, onInteractionEnd }: {
  range: Range;
  durationSeconds: number;
  previousEndSeconds?: number;
  nextStartSeconds?: number;
  onChange: (range: Range) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
}) {
  const ui = useUiText();
  const [selectedEdge, setSelectedEdge] = useState<"start" | "end">("start");
  const selectedLabel = selectedEdge === "start" ? "시작" : "종료";
  const selectedValue = range[`${selectedEdge}Seconds`];
  const minimum = selectedEdge === "start" ? previousEndSeconds : range.startSeconds + COMMENT_RANGE_MIN_SECONDS;
  const maximum = selectedEdge === "start" ? range.endSeconds - COMMENT_RANGE_MIN_SECONDS : nextStartSeconds;
  const update = (edge: "start" | "end", seconds: number) => {
    const next = adjustTimedRange(range, edge, seconds - range[`${edge}Seconds`], durationSeconds, previousEndSeconds, nextStartSeconds);
    if (next.startSeconds === range.startSeconds && next.endSeconds === range.endSeconds) return;
    onInteractionStart();
    onChange(next);
    onInteractionEnd();
  };
  return <fieldset className="editor-timing-controls">
    <legend>{ui("표시 시간")}</legend>
    <div className="editor-time-range">
      <TimeField label="시작" value={range.startSeconds} minimum={previousEndSeconds} maximum={range.endSeconds - COMMENT_RANGE_MIN_SECONDS} selected={selectedEdge === "start"} onSelect={() => setSelectedEdge("start")} onChange={(value) => update("start", value)} />
      <span className="editor-time-range-arrow" aria-hidden="true">→</span>
      <TimeField label="종료" value={range.endSeconds} minimum={range.startSeconds + COMMENT_RANGE_MIN_SECONDS} maximum={nextStartSeconds} selected={selectedEdge === "end"} onSelect={() => setSelectedEdge("end")} onChange={(value) => update("end", value)} />
    </div>
    <div className="editor-time-adjustment">
      <span>{ui(selectedEdge === "start" ? "시작 조절" : "종료 조절")}</span>
      <div className="editor-time-stepper">
        <button type="button" aria-label={ui(`${selectedLabel} 0.1초 줄이기`)} disabled={selectedValue <= minimum + 0.0001} onClick={() => update(selectedEdge, selectedValue - 0.1)}>−0.1</button>
        <button type="button" aria-label={ui(`${selectedLabel} 0.1초 늘리기`)} disabled={selectedValue >= maximum - 0.0001} onClick={() => update(selectedEdge, selectedValue + 0.1)}>+0.1</button>
      </div>
    </div>
  </fieldset>;
}
