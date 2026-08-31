"use client";

import { EditorFontPicker } from "@/components/editor-font-picker";
import { DEFAULT_EDITOR_FONT_ID, editorFontOptions, type EditorFontId } from "@/lib/editor-fonts";
import { EDITOR_TEXT_MAX_WIDTH, EDITOR_TEXT_MIN_WIDTH, type EditorTextOverlay } from "@/lib/editor-overlay-preview";
import { templatePresetColorOptions } from "@/lib/template-config";

export type EditorTextStylePatch = Partial<Pick<EditorTextOverlay, "text" | "fontId" | "color" | "effect">>;

export function EditorTextOverlayControls({
  textOverlay,
  onChange,
  onFontChange,
  onInteractionStart,
  onInteractionEnd,
  onDelete,
  fontOptions,
  geometryControls,
}: {
  textOverlay: Omit<EditorTextOverlay, "startSeconds" | "endSeconds">;
  onChange: (patch: EditorTextStylePatch, historyMode?: "continuous" | "record") => void;
  onFontChange: (fontId: EditorFontId) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onDelete: () => void;
  fontOptions?: readonly (typeof editorFontOptions)[number][];
  geometryControls?: {
    onScaleChange: (scale: number) => void;
    onWidthChange: (width: number) => void;
    onMoveLayer: (direction: "forward" | "backward") => void;
    canMoveForward: boolean;
    canMoveBackward: boolean;
  };
}) {
  return <div className="editor-element-settings">
    <label className="editor-text-content-setting">
      <span>내용</span>
      <textarea
        value={textOverlay.text}
        maxLength={120}
        rows={2}
        onFocus={onInteractionStart}
        onBlur={onInteractionEnd}
        onChange={(event) => onChange({ text: event.target.value }, "continuous")}
      />
    </label>
    <EditorFontPicker value={textOverlay.fontId || DEFAULT_EDITOR_FONT_ID} onChange={onFontChange} options={fontOptions} />
    <fieldset className="editor-text-color-setting">
      <legend>색상</legend>
      <div>{templatePresetColorOptions.map((option) => <button
        key={option.color}
        type="button"
        aria-label={`텍스트 색상 ${option.name}`}
        title={option.name}
        aria-pressed={textOverlay.color === option.color}
        onClick={() => onChange({ color: option.color })}
        style={{ backgroundColor: option.color }}
      />)}</div>
    </fieldset>
    <fieldset className="editor-text-effect-setting">
      <legend>효과</legend>
      <div>{([['none', '없음'], ['outline', '테두리'], ['shadow', '그림자']] as const).map(([effect, label]) => <button
        key={effect}
        type="button"
        aria-pressed={(textOverlay.effect || "outline") === effect}
        onClick={() => onChange({ effect })}
      >{label}</button>)}</div>
    </fieldset>
    {geometryControls && <div className="mt-5 space-y-5 border-t border-white/10 pt-4">
      <label className="block text-sm font-semibold text-neutral-200">글자 크기 <span className="float-right text-[#ff9b8d]">{Math.round(textOverlay.scale * 100)}%</span>
        <input
          aria-label="추가한 텍스트 글자 크기"
          type="range" min={0.5} max={2} step={0.01} value={textOverlay.scale}
          onPointerDown={onInteractionStart} onPointerUp={onInteractionEnd} onPointerCancel={onInteractionEnd}
          onKeyDown={onInteractionStart} onKeyUp={onInteractionEnd} onBlur={onInteractionEnd}
          onChange={(event) => geometryControls.onScaleChange(Number(event.target.value))}
          className="mt-3 w-full accent-[#ff715e]"
        />
      </label>
      <label className="block text-sm font-semibold text-neutral-200">텍스트 폭 <span className="float-right text-[#ff9b8d]">{Math.round(textOverlay.width)}px</span>
        <input
          aria-label="추가한 텍스트 폭"
          type="range" min={EDITOR_TEXT_MIN_WIDTH} max={EDITOR_TEXT_MAX_WIDTH} step={1} value={textOverlay.width}
          onPointerDown={onInteractionStart} onPointerUp={onInteractionEnd} onPointerCancel={onInteractionEnd}
          onKeyDown={onInteractionStart} onKeyUp={onInteractionEnd} onBlur={onInteractionEnd}
          onChange={(event) => geometryControls.onWidthChange(Number(event.target.value))}
          className="mt-3 w-full accent-[#ff715e]"
        />
      </label>
      <div className="flex items-center justify-between gap-3" aria-label="추가한 텍스트 레이어 순서">
        <span className="text-sm font-semibold text-neutral-200">앞뒤 순서</span>
        <div className="flex gap-2">
          <button type="button" disabled={!geometryControls.canMoveForward} onClick={() => geometryControls.onMoveLayer("forward")} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold disabled:opacity-30">앞으로</button>
          <button type="button" disabled={!geometryControls.canMoveBackward} onClick={() => geometryControls.onMoveLayer("backward")} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-bold disabled:opacity-30">뒤로</button>
        </div>
      </div>
      <p className="text-[11px] leading-5 text-neutral-500">미리보기에서 끌어 이동하고 양쪽 손잡이로 폭을 조절하세요. 채널명은 맨앞에 유지됩니다.</p>
    </div>}
    <button type="button" className="editor-v2-text-delete mt-5 rounded-lg border border-red-300/20 px-3 py-2 text-xs font-bold text-red-200" onClick={onDelete}>선택한 텍스트 삭제</button>
  </div>;
}
