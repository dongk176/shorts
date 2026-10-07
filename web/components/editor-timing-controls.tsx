"use client";

import { useEffect, useId, useState } from "react";
import { useUiText } from "@/lib/i18n/use-ui-text";
import { adjustTimedRange, COMMENT_RANGE_MIN_SECONDS } from "@/lib/range-editing";

type Range = { startSeconds: number; endSeconds: number };
const secondsText = (seconds: number) => String(Math.round(seconds * 1000) / 1000);

function TimeField({ label, value, minimum, maximum, onChange }: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
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
  return <div className="editor-time-field">
    <label htmlFor={inputId}>{ui(label)}</label>
    <div className="editor-time-stepper">
      <button type="button" aria-label={ui(`${label} 0.1초 줄이기`)} disabled={value <= minimum + 0.0001} onClick={() => onChange(value - 0.1)}>−0.1</button>
      <input
        id={inputId}
        type="number"
        inputMode="decimal"
        aria-label={ui(`${label} (초)`)}
        min={minimum}
        max={maximum}
        step="0.1"
        value={draft}
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
      <button type="button" aria-label={ui(`${label} 0.1초 늘리기`)} disabled={value >= maximum - 0.0001} onClick={() => onChange(value + 0.1)}>+0.1</button>
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
  const update = (edge: "start" | "end", seconds: number) => {
    const next = adjustTimedRange(range, edge, seconds - range[`${edge}Seconds`], durationSeconds, previousEndSeconds, nextStartSeconds);
    if (next.startSeconds === range.startSeconds && next.endSeconds === range.endSeconds) return;
    onInteractionStart();
    onChange(next);
    onInteractionEnd();
  };
  return <fieldset className="editor-timing-controls">
    <legend>{ui("표시 시간")} <span>{ui("초")}</span></legend>
    <TimeField label="시작" value={range.startSeconds} minimum={previousEndSeconds} maximum={range.endSeconds - COMMENT_RANGE_MIN_SECONDS} onChange={(value) => update("start", value)} />
    <TimeField label="종료" value={range.endSeconds} minimum={range.startSeconds + COMMENT_RANGE_MIN_SECONDS} maximum={nextStartSeconds} onChange={(value) => update("end", value)} />
    <p>{ui("0.1초씩 조절하거나 시간을 직접 입력하세요.")}</p>
  </fieldset>;
}
