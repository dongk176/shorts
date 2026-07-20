"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  TEMPLATE_CANVAS,
  COMMENT_BACKGROUND_COLOR,
  aspectHeightRatio,
  stockBackgrounds,
  templatePresetColorOptions,
  videoFrameForAspect,
  type CustomTemplate,
  type TemplatePresetColor,
  type TemplateConfig,
} from "@/lib/template-config";
import { videoAspectRatioOptions, type TemplateId, type VideoAspectRatio } from "@/lib/contracts";
import { CustomTemplateTitlePreview } from "@/components/custom-template-title-preview";
import {
  CUSTOM_COMMENT_Y_MAX,
  CUSTOM_COMMENT_Y_MIN,
  customCanvasWidth,
  customCenteredLayerStyle,
  customCommentCanDockToVideo,
  customCommentLayerY,
  customVideoFrameStyle,
} from "@/lib/custom-template-preview-layout";
import { CENTER_SNAP_THRESHOLD_PX, snapAxisToCenter } from "@/lib/template-editor-snap";
import { TemplateCommentPrototype } from "@/components/template-comment-prototype";

type LayerId = "video" | "title" | "channel" | "comment";
type TemplateLayerId = Exclude<LayerId, "comment">;
type TextLayerId = Exclude<TemplateLayerId, "video">;
type History = { past: TemplateConfig[]; present: TemplateConfig; future: TemplateConfig[] };
type CenterGuides = { x: boolean; y: boolean };

const layerLabels: Record<LayerId, string> = { video: "영상", title: "제목", channel: "채널명", comment: "댓글" };
const standardLayerIds: LayerId[] = ["video", "title", "channel"];
const commentLayerIds: LayerId[] = [...standardLayerIds, "comment"];
const commentSizeOptions: { value: TemplateConfig["comment"]["size"]; label: string }[] = [
  { value: "small", label: "작게" },
  { value: "medium", label: "기본" },
  { value: "large", label: "크게" },
];
const commentThemeOptions = [
  { value: "dark", label: "다크 모드", background: COMMENT_BACKGROUND_COLOR, foreground: "#ffffff" },
  { value: "light", label: "화이트 모드", background: "#ffffff", foreground: "#18181b" },
] as const;
const COMMENT_VIDEO_SNAP_THRESHOLD_PX = 18;
const COMMENT_Y_MIN = CUSTOM_COMMENT_Y_MIN;
const COMMENT_Y_MAX = CUSTOM_COMMENT_Y_MAX;
const hiddenCenterGuides: CenterGuides = { x: false, y: false };
const compactTextColors = ["#FFFFFF", "#111111", "#35E6E3"] as const satisfies readonly TemplatePresetColor[];
const compactTextBackgroundColors = ["#111111", "#FFFFFF"] as const satisfies readonly TemplatePresetColor[];
const compactBackgroundColors = [COMMENT_BACKGROUND_COLOR, "#000000", "#111111", "#FFFFFF", "#F3F0E9", "#E32626", "#2563EB"] as const satisfies readonly TemplatePresetColor[];

function cloneConfig(config: TemplateConfig) {
  return structuredClone(config);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapCommentYToVideo(candidateY: number, videoBottom: number, threshold: number) {
  if (videoBottom < COMMENT_Y_MIN || videoBottom > COMMENT_Y_MAX) {
    return { value: candidateY, snapped: false };
  }
  return snapAxisToCenter(candidateY, videoBottom, threshold);
}

function backgroundStyle(config: TemplateConfig): React.CSSProperties {
  if (config.background.kind === "color") return { backgroundColor: config.background.color };
  const assetId = config.background.assetId;
  const asset = stockBackgrounds.find((item) => item.id === assetId);
  return { backgroundImage: `url(${asset?.src || ""})`, backgroundPosition: "center", backgroundSize: "cover" };
}

function compactColorOptions(value: TemplatePresetColor | null, colors: readonly TemplatePresetColor[]) {
  const defaults = colors.map((color) => templatePresetColorOptions.find((option) => option.color === color)!);
  if (!value || defaults.some((option) => option.color === value)) return defaults;
  const selected = templatePresetColorOptions.find((option) => option.color === value);
  return selected ? [selected, ...defaults.slice(0, colors.length - 1)] : defaults;
}

function ColorPalette({ value, onChange, allowNone = false }: { value: TemplatePresetColor | null; onChange: (value: TemplatePresetColor | null) => void; allowNone?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visibleOptions = expanded
    ? templatePresetColorOptions
    : compactColorOptions(value, allowNone ? compactTextBackgroundColors : compactTextColors);
  return (
    <div className="flex flex-wrap gap-2">
      {allowNone && <button type="button" title="없음" aria-label="배경 없음" aria-pressed={value === null} onClick={() => onChange(null)} className={`flex h-8 w-8 items-center justify-center rounded-full border border-dashed text-[8px] font-bold transition ${value === null ? "border-[#ff715e] text-white ring-2 ring-[#ff715e]/25" : "border-white/35 bg-white/[.03] text-neutral-400 hover:border-white/60 hover:text-white"}`}>없음</button>}
      {visibleOptions.map((option) => (
        <button key={option.color} type="button" title={option.name} aria-label={`색상 ${option.name}`} aria-pressed={value === option.color} onClick={() => onChange(option.color)} className={`h-8 w-8 rounded-full border border-white/20 transition ${value === option.color ? "ring-2 ring-[#ff715e] ring-offset-2 ring-offset-[#19191c]" : "hover:scale-105 hover:border-white/50"}`} style={{ backgroundColor: option.color }} />
      ))}
      <button type="button" title={expanded ? "접기" : "전체 보기"} aria-label={expanded ? "색상 접기" : "색상 전체 보기"} aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#353438] text-base font-medium text-neutral-200 transition hover:border-white/40 hover:bg-[#454449]">{expanded ? "−" : "+"}</button>
    </div>
  );
}

export function TemplateEditor({ initialTemplate, baseTemplateId, initialConfig }: { initialTemplate: CustomTemplate | null; baseTemplateId: TemplateId; initialConfig: TemplateConfig }) {
  const commentLayerEnabled = baseTemplateId === "comment-capture";
  const [history, setHistory] = useState<History>({ past: [], present: initialConfig, future: [] });
  const [name, setName] = useState(initialTemplate?.name || "나의 템플릿");
  const [selectedLayer, setSelectedLayer] = useState<LayerId>("title");
  const [zoom, setZoom] = useState(1);
  const [showAllBackgroundColors, setShowAllBackgroundColors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedTemplate, setSavedTemplate] = useState(initialTemplate);
  const [centerGuides, setCenterGuides] = useState<CenterGuides>(hiddenCenterGuides);
  const [commentSnapGuide, setCommentSnapGuide] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const transactionRef = useRef<TemplateConfig | null>(null);
  const baselineRef = useRef(JSON.stringify({ name: initialTemplate?.name || "나의 템플릿", config: initialConfig }));
  const config = history.present;
  const dirty = JSON.stringify({ name, config }) !== baselineRef.current;
  const availableLayerIds = commentLayerEnabled ? commentLayerIds : standardLayerIds;
  const videoBottom = config.video.y + config.video.height;
  const commentCanDockToVideo = customCommentCanDockToVideo(config.video);
  const commentIsDockedToVideo = config.comment.dockedToVideo && commentCanDockToVideo;
  const commentY = customCommentLayerY(config);

  const commit = useCallback((updater: (current: TemplateConfig) => TemplateConfig) => {
    setHistory((current) => {
      const next = updater(cloneConfig(current.present));
      if (JSON.stringify(next) === JSON.stringify(current.present)) return current;
      return { past: [...current.past.slice(-49), current.present], present: next, future: [] };
    });
  }, []);

  const updateTransient = useCallback((updater: (current: TemplateConfig) => TemplateConfig) => {
    setHistory((current) => ({ ...current, present: updater(cloneConfig(current.present)), future: [] }));
  }, []);

  const undo = useCallback(() => setHistory((current) => {
    const previous = current.past.at(-1);
    if (!previous) return current;
    return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future].slice(0, 50) };
  }), []);
  const redo = useCallback(() => setHistory((current) => {
    const next = current.future[0];
    if (!next) return current;
    return { past: [...current.past.slice(-49), current.present], present: next, future: current.future.slice(1) };
  }), []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [redo, undo]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const beginPointerAction = (event: ReactPointerEvent, layer: TemplateLayerId, mode: "move" | "resize" = "move") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLayer(layer);
    setCenterGuides(hiddenCenterGuides);
    event.currentTarget.setPointerCapture(event.pointerId);
    transactionRef.current = cloneConfig(config);
    const startX = event.clientX;
    const startY = event.clientY;
    const startConfig = cloneConfig(config);
    const rect = canvas.getBoundingClientRect();
    const toCanvasX = TEMPLATE_CANVAS.width / rect.width;
    const toCanvasY = TEMPLATE_CANVAS.height / rect.height;

    const move = (moveEvent: PointerEvent) => {
      const dx = Math.round((moveEvent.clientX - startX) * toCanvasX);
      const dy = Math.round((moveEvent.clientY - startY) * toCanvasY);
      const snapThresholdX = CENTER_SNAP_THRESHOLD_PX * toCanvasX;
      const snapThresholdY = CENTER_SNAP_THRESHOLD_PX * toCanvasY;

      if (mode === "move") {
        if (layer === "video") {
          const maxX = TEMPLATE_CANVAS.width - startConfig.video.width;
          const maxY = TEMPLATE_CANVAS.height - startConfig.video.height;
          const candidateX = clamp(startConfig.video.x + dx, 0, maxX);
          const candidateY = clamp(startConfig.video.y + dy, 0, maxY);
          const horizontal = snapAxisToCenter(
            candidateX + startConfig.video.width / 2,
            TEMPLATE_CANVAS.width / 2,
            snapThresholdX,
          );
          const vertical = snapAxisToCenter(
            candidateY + startConfig.video.height / 2,
            TEMPLATE_CANVAS.height / 2,
            snapThresholdY,
          );

          updateTransient((next) => {
            next.video.x = Math.round(clamp(horizontal.value - startConfig.video.width / 2, 0, maxX));
            next.video.y = Math.round(clamp(vertical.value - startConfig.video.height / 2, 0, maxY));
            return next;
          });
          setCenterGuides({ x: horizontal.snapped, y: vertical.snapped });
          return;
        }

        const candidateX = clamp(startConfig[layer].x + dx, 0, TEMPLATE_CANVAS.width);
        const candidateY = clamp(startConfig[layer].y + dy, 0, TEMPLATE_CANVAS.height);
        const horizontal = snapAxisToCenter(candidateX, TEMPLATE_CANVAS.width / 2, snapThresholdX);
        const vertical = snapAxisToCenter(candidateY, TEMPLATE_CANVAS.height / 2, snapThresholdY);

        updateTransient((next) => {
          next[layer].x = horizontal.value;
          next[layer].y = vertical.value;
          return next;
        });
        setCenterGuides({ x: horizontal.snapped, y: vertical.snapped });
        return;
      }

      updateTransient((next) => {
        const ratio = aspectHeightRatio(next.video.aspectRatio);
        const maxWidth = Math.min(TEMPLATE_CANVAS.width - startConfig.video.x, (TEMPLATE_CANVAS.height - startConfig.video.y) / ratio);
        const width = Math.round(clamp(startConfig.video.width + dx, 240, maxWidth));
        next.video.width = width;
        next.video.height = Math.round(width * ratio);
        return next;
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setCenterGuides(hiddenCenterGuides);
      const before = transactionRef.current;
      transactionRef.current = null;
      if (!before) return;
      setHistory((current) => JSON.stringify(before) === JSON.stringify(current.present)
        ? current
        : { past: [...current.past.slice(-49), before], present: current.present, future: [] });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const beginCommentPointerAction = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLayer("comment");
    event.currentTarget.setPointerCapture(event.pointerId);
    transactionRef.current = cloneConfig(config);
    const startPointerY = event.clientY;
    const startLayerY = commentY;
    const toCanvasY = TEMPLATE_CANVAS.height / canvas.getBoundingClientRect().height;

    const move = (moveEvent: PointerEvent) => {
      const deltaY = Math.round((moveEvent.clientY - startPointerY) * toCanvasY);
      const candidateY = clamp(startLayerY + deltaY, COMMENT_Y_MIN, COMMENT_Y_MAX);
      const vertical = snapCommentYToVideo(
        candidateY,
        videoBottom,
        COMMENT_VIDEO_SNAP_THRESHOLD_PX * toCanvasY,
      );
      updateTransient((next) => {
        next.comment.y = vertical.value;
        next.comment.dockedToVideo = vertical.snapped;
        return next;
      });
      setCommentSnapGuide(vertical.snapped);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      setCommentSnapGuide(false);
      const before = transactionRef.current;
      transactionRef.current = null;
      if (!before) return;
      setHistory((current) => JSON.stringify(before) === JSON.stringify(current.present)
        ? current
        : { past: [...current.past.slice(-49), before], present: current.present, future: [] });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };

  const changeAspect = (aspectRatio: VideoAspectRatio) => commit((next) => {
    const preferredWidth = Math.min(next.video.width, TEMPLATE_CANVAS.width);
    next.video = videoFrameForAspect(aspectRatio, preferredWidth);
    return next;
  });

  const save = async () => {
    if (!name.trim()) { setMessage("템플릿 이름을 입력해 주세요."); return; }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(savedTemplate ? `/api/templates/${savedTemplate.id}` : "/api/templates", {
        method: savedTemplate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savedTemplate
          ? { name: name.trim(), config, version: savedTemplate.version }
          : { name: name.trim(), baseTemplateId, config }),
      });
      const payload = await response.json() as { template?: CustomTemplate; detail?: string };
      if (!response.ok || !payload.template) throw new Error(payload.detail || "템플릿을 저장하지 못했습니다.");
      setSavedTemplate(payload.template);
      setName(payload.template.name);
      setHistory({ past: [], present: payload.template.config, future: [] });
      baselineRef.current = JSON.stringify({ name: payload.template.name, config: payload.template.config });
      setMessage("템플릿을 저장했습니다. 홈의 템플릿 선택에서도 바로 사용할 수 있습니다.");
      if (!initialTemplate) window.history.replaceState(null, "", `/templates/${payload.template.id}/edit`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "템플릿을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const selectedTextLayer = selectedLayer === "title" || selectedLayer === "channel" ? config[selectedLayer] : null;
  const background = backgroundStyle(config);
  const selectedBackgroundColor = config.background.kind === "color" ? config.background.color : null;
  const visibleBackgroundColors = showAllBackgroundColors
    ? templatePresetColorOptions
    : compactColorOptions(selectedBackgroundColor, compactBackgroundColors);

  return (
    <div className="min-h-dvh bg-[#101012] text-neutral-100">
      <div className="hidden min-h-dvh lg:block">
        <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-white/10 bg-[#171719]/95 px-5 backdrop-blur-xl">
          <div className="flex items-center gap-4"><Link href="/templates" className="text-sm font-bold text-neutral-400 hover:text-white">← 라이브러리</Link><span className="h-5 w-px bg-white/10" /><strong className="tracking-[-.03em]">Easy Cut <span className="text-[#ff715e]">템플릿 커스텀</span></strong></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={undo} disabled={!history.past.length} className="rounded-lg border border-white/10 px-3 py-2 text-sm disabled:opacity-30" aria-label="실행 취소">↶ 되돌리기</button>
            <button type="button" onClick={redo} disabled={!history.future.length} className="rounded-lg border border-white/10 px-3 py-2 text-sm disabled:opacity-30" aria-label="다시 실행">↷ 복구하기</button>
          </div>
        </header>

        <main className="min-h-dvh pb-10 pl-6 pr-[504px] pt-24">
          <div className="mx-auto flex max-w-[920px] flex-col items-center">
            <div className="mb-4 flex w-full max-w-[500px] items-center justify-between text-xs font-bold text-neutral-500"><span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-emerald-300">● LIVE PREVIEW</span><span>9:16 · 1080 × 1920</span></div>
            <div className="flex min-h-[680px] w-full items-center justify-center overflow-auto">
              <div style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}>
                <div ref={canvasRef} className="relative aspect-[9/16] w-[360px] touch-none overflow-hidden rounded-[12px] shadow-[0_30px_100px_rgba(0,0,0,.65)]" style={{ ...background, containerType: "inline-size" }} onPointerDown={() => setSelectedLayer("video")}>
                  <div onPointerDown={(event) => beginPointerAction(event, "video")} className={`absolute cursor-move overflow-hidden bg-neutral-700 ${selectedLayer === "video" ? "ring-2 ring-[#ff715e] ring-inset" : ""}`} style={customVideoFrameStyle(config.video)}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#73737c,#2c2c31_70%)]" /><div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
                    <button type="button" aria-label="영상 크기 조절" onPointerDown={(event) => beginPointerAction(event, "video", "resize")} className="absolute bottom-0 right-0 h-6 w-6 cursor-nwse-resize border-l border-t border-white bg-[#ff715e]" />
                  </div>
                  <CustomTemplateTitlePreview title={config.title} firstLine="놓치면 후회할" secondLine="핵심 한 가지" selected={selectedLayer === "title"} onPointerDown={(event) => beginPointerAction(event, "title")} />
                  {config.channel.visible && !commentLayerEnabled && <button type="button" onPointerDown={(event) => beginPointerAction(event, "channel")} className={`absolute z-30 cursor-move truncate rounded px-[1.8cqw] py-[.8cqw] text-center font-bold ${selectedLayer === "channel" ? "outline outline-2 outline-[#ff715e]" : ""}`} style={{ ...customCenteredLayerStyle(config.channel), color: config.channel.color, backgroundColor: config.channel.backgroundColor || "transparent", fontSize: customCanvasWidth(config.channel.fontSize) }}>● Easy Cut</button>}
                  {commentLayerEnabled && <div className="absolute inset-x-0 z-40" style={{ top: `${(commentY / TEMPLATE_CANVAS.height) * 100}%` }}>
                    {config.comment.visible && <TemplateCommentPrototype selected={selectedLayer === "comment"} theme={config.comment.theme} size={config.comment.size} onSelect={() => setSelectedLayer("comment")} onPointerDown={beginCommentPointerAction} />}
                    {config.channel.visible && <button type="button" onClick={() => setSelectedLayer("channel")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); setSelectedLayer("channel"); }} className={`relative z-30 mx-auto mt-[2cqw] block truncate rounded px-[1.8cqw] py-[.8cqw] text-center font-bold ${selectedLayer === "channel" ? "outline outline-2 outline-[#ff715e]" : ""}`} style={{ width: customCanvasWidth(config.channel.maxWidth), color: config.channel.color, backgroundColor: config.channel.backgroundColor || "transparent", fontSize: customCanvasWidth(config.channel.fontSize) }}>● Easy Cut</button>}
                  </div>}
                  {commentSnapGuide && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-50 h-px bg-[#35e6e3] shadow-[0_0_7px_rgba(53,230,227,.9)]" style={{ top: `${(videoBottom / TEMPLATE_CANVAS.height) * 100}%` }}><span className="absolute right-2 -translate-y-full rounded-t bg-[#35e6e3] px-1.5 py-0.5 text-[7px] font-black text-black">영상 하단에 맞춤</span></div>}
                  {centerGuides.x && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/2 z-50 w-px -translate-x-1/2 bg-[#ff2bd6] shadow-[0_0_5px_rgba(255,43,214,.95)]" />}
                  {centerGuides.y && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 z-50 h-px -translate-y-1/2 bg-[#ff2bd6] shadow-[0_0_5px_rgba(255,43,214,.95)]" />}
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-[#19191c] p-1"><button type="button" onClick={() => setZoom((value) => clamp(value - .1, .7, 1.2))} className="h-9 w-9 rounded-lg hover:bg-white/5">−</button><span className="w-14 text-center text-xs font-bold">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => clamp(value + .1, .7, 1.2))} className="h-9 w-9 rounded-lg hover:bg-white/5">＋</button></div>
          </div>
        </main>

        <aside className="fixed bottom-0 right-0 top-16 z-40 flex w-[480px] flex-col border-l border-white/10 bg-[#19191c]">
          <div className="flex-1 space-y-9 overflow-y-auto px-6 pb-32 pt-7">
            <div><h1 className="text-xl font-extrabold tracking-[-.025em] text-[#f6f4f7]">템플릿 편집</h1><p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">왼쪽 미리보기에서 변경 내용을 실시간으로 확인하세요.</p></div>

            <section><label className="block text-[15px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">템플릿 이름<input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm font-medium text-white outline-none transition focus:border-[#ff715e]" /></label></section>

            <section><h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">편집 레이어</h2><p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">미리보기에서 직접 선택하거나 아래 레이어를 고르세요.</p><div className={`mt-3 grid gap-1.5 rounded-xl border border-white/10 bg-black/20 p-1.5 ${commentLayerEnabled ? "grid-cols-4" : "grid-cols-3"}`}>{availableLayerIds.map((layer) => <button key={layer} type="button" onClick={() => setSelectedLayer(layer)} className={`rounded-lg px-1 py-2.5 text-xs font-bold transition ${selectedLayer === layer ? "bg-[#ff715e] text-black" : "text-neutral-400 hover:bg-white/5 hover:text-white"}`}>{layerLabels[layer]}</button>)}</div></section>

            {selectedLayer === "video" && <section><h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">영상 프레임</h2><div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5"><h3 className="text-sm font-semibold text-neutral-200">영상 비율</h3><div className="mt-3 grid grid-cols-5 gap-1">{videoAspectRatioOptions.map((option) => <button key={option.value} type="button" onClick={() => changeAspect(option.value)} className={`rounded-lg py-2 text-[10px] font-bold transition ${config.video.aspectRatio === option.value ? "bg-white text-black" : "bg-white/5 text-neutral-400 hover:bg-white/10"}`}>{option.value}</button>)}</div><p className="mt-3 text-[11px] leading-5 text-neutral-500">프레임을 끌어 이동하고 오른쪽 아래 핸들로 비율을 유지한 채 크기를 조절하세요.</p></div></section>}

            {selectedTextLayer && <section><h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">{selectedLayer === "title" ? "제목 스타일" : "채널명 스타일"}</h2><div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold text-neutral-200">레이어 표시</span><button type="button" onClick={() => commit((next) => { next[selectedLayer as TextLayerId].visible = !selectedTextLayer.visible; return next; })} className={`rounded-full px-3 py-1 text-xs font-bold ${selectedTextLayer.visible ? "bg-emerald-400 text-black" : "bg-white/10 text-neutral-400"}`}>{selectedTextLayer.visible ? "켜짐" : "꺼짐"}</button></div>
              <label className="mt-5 block border-t border-white/10 pt-4 text-sm font-semibold text-neutral-200">글자 크기 <span className="float-right text-sm text-[#ff9b8d]">{selectedTextLayer.fontSize}px</span><input type="range" min={selectedLayer === "channel" ? 20 : 24} max={selectedLayer === "title" ? 96 : 64} value={selectedTextLayer.fontSize} onChange={(event) => commit((next) => { next[selectedLayer as TextLayerId].fontSize = Number(event.target.value); return next; })} className="mt-3 w-full accent-[#ff715e]" /></label>
              {selectedLayer === "title" ? <>
                <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold text-neutral-200">1행 제목</h3><div className="mt-3 grid grid-cols-2 gap-5"><div><p className="text-xs font-semibold text-neutral-400">글자색</p><div className="mt-2"><ColorPalette key="title-line-1-text" value={config.title.primaryColor} onChange={(color) => { if (color) commit((next) => { next.title.primaryColor = color; return next; }); }} /></div></div><div><p className="text-xs font-semibold text-neutral-400">배경색</p><div className="mt-2"><ColorPalette key="title-line-1-background" allowNone value={config.title.primaryBackgroundColor} onChange={(color) => commit((next) => { next.title.primaryBackgroundColor = color; return next; })} /></div></div></div></div>
                <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold text-neutral-200">2행 제목</h3><div className="mt-3 grid grid-cols-2 gap-5"><div><p className="text-xs font-semibold text-neutral-400">글자색</p><div className="mt-2"><ColorPalette key="title-line-2-text" value={config.title.accentColor} onChange={(color) => { if (color) commit((next) => { next.title.accentColor = color; return next; }); }} /></div></div><div><p className="text-xs font-semibold text-neutral-400">배경색</p><div className="mt-2"><ColorPalette key="title-line-2-background" allowNone value={config.title.accentBackgroundColor} onChange={(color) => commit((next) => { next.title.accentBackgroundColor = color; return next; })} /></div></div></div></div>
              </> : <div className="mt-5 border-t border-white/10 pt-4"><h3 className="text-sm font-semibold text-neutral-200">채널명</h3>{commentLayerEnabled && <p className="mt-1.5 text-[11px] leading-5 text-neutral-500">댓글 카드 크기가 바뀌어도 채널명은 항상 카드 아래로 자동 정렬됩니다.</p>}<div className="mt-3 grid grid-cols-2 gap-5"><div><p className="text-xs font-semibold text-neutral-400">글자색</p><div className="mt-2"><ColorPalette key="channel-color" value={config.channel.color} onChange={(color) => { if (color) commit((next) => { next.channel.color = color; return next; }); }} /></div></div><div><p className="text-xs font-semibold text-neutral-400">배경색</p><div className="mt-2"><ColorPalette key="channel-background" allowNone value={config.channel.backgroundColor} onChange={(color) => commit((next) => { next.channel.backgroundColor = color; return next; })} /></div></div></div></div>}
            </div></section>}

            {selectedLayer === "comment" && commentLayerEnabled && <section>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">댓글 레이아웃</h2>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">렌더링 적용</span>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">예시 문구는 편집용으로 고정되며, 저장한 모드·크기·위치가 실제 댓글에 적용됩니다.</p>
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-200">레이어 표시</span>
                  <button type="button" onClick={() => commit((next) => { next.comment.visible = !next.comment.visible; return next; })} className={`rounded-full px-3 py-1 text-xs font-bold ${config.comment.visible ? "bg-emerald-400 text-black" : "bg-white/10 text-neutral-400"}`}>{config.comment.visible ? "켜짐" : "꺼짐"}</button>
                </div>

                <div className="mt-5 border-t border-white/10 pt-4">
                  <h3 className="text-sm font-semibold text-neutral-200">댓글 모드</h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {commentThemeOptions.map((option) => <button key={option.value} type="button" onClick={() => commit((next) => { next.comment.theme = option.value; return next; })} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold transition ${config.comment.theme === option.value ? "border-[#ff715e] bg-[#ff715e]/10 text-white" : "border-white/10 bg-white/[.03] text-neutral-400 hover:border-white/30 hover:text-white"}`}><span className="h-5 w-8 border border-white/15" style={{ backgroundColor: option.background }}><span className="mx-auto mt-[8px] block h-px w-4" style={{ backgroundColor: option.foreground }} /></span>{option.label}</button>)}
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-neutral-500">두 모드 모두 가로 여백 없이 캔버스 너비 전체를 채우며 모서리는 각지게 유지합니다.</p>
                </div>

                <div className="mt-5 border-t border-white/10 pt-4">
                  <h3 className="text-sm font-semibold text-neutral-200">댓글 크기</h3>
                  <div className="mt-3 grid grid-cols-3 gap-1.5">{commentSizeOptions.map((option) => <button key={option.value} type="button" onClick={() => commit((next) => { next.comment.size = option.value; return next; })} className={`rounded-lg py-2.5 text-xs font-bold transition ${config.comment.size === option.value ? "bg-white text-black" : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"}`}>{option.label}</button>)}</div>
                  <p className="mt-2 text-[11px] leading-5 text-neutral-500">크기를 바꾸면 프로필·문구·반응 버튼과 안쪽 여백이 함께 줄고, 카드 높이도 내용에 맞춰 자동 조절됩니다.</p>
                </div>

                <label className="mt-5 block border-t border-white/10 pt-4 text-sm font-semibold text-neutral-200">세로 위치 <span className="float-right text-sm text-[#ff9b8d]">{Math.round((commentY / TEMPLATE_CANVAS.height) * 100)}%</span><input type="range" min={COMMENT_Y_MIN} max={COMMENT_Y_MAX} step={10} value={commentY} onChange={(event) => { const vertical = snapCommentYToVideo(Number(event.target.value), videoBottom, 30); commit((next) => { next.comment.y = vertical.value; next.comment.dockedToVideo = vertical.snapped; return next; }); }} className="mt-3 w-full accent-[#ff715e]" /></label>
                <p className={`mt-2 text-[11px] leading-5 ${commentIsDockedToVideo ? "font-semibold text-[#74efec]" : "text-neutral-500"}`}>{commentIsDockedToVideo ? "영상 하단에 자석처럼 붙어 있습니다." : "슬라이더를 쓰거나 댓글 카드를 끌어 영상 하단 가까이 가져가 보세요."}</p>

                <div className="mt-5 rounded-lg border border-emerald-300/20 bg-emerald-300/[.06] px-3 py-2.5 text-[11px] leading-5 text-emerald-100/75">저장하면 댓글 카드와 채널명 배치가 완성 영상에도 같은 설정으로 적용됩니다.</div>
              </div>
            </section>}

            <section><h2 className="text-[17px] font-extrabold tracking-[-.015em] text-[#f2f0f4]">배경</h2><p className="mt-1.5 text-xs leading-5 text-[#8f8e97]">완성 영상과 같은 9:16 비율로 배경을 비교하세요.</p><div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3.5">
              <h3 className="text-sm font-semibold text-neutral-200">이미지 배경</h3><div className="mt-3 grid grid-cols-3 gap-2">{stockBackgrounds.map((asset) => <button key={asset.id} type="button" title={asset.label} aria-label={`${asset.label} 배경 선택`} aria-pressed={config.background.kind === "image" && config.background.assetId === asset.id} onClick={() => commit((next) => { next.background = { kind: "image", assetId: asset.id }; return next; })} className={`relative aspect-[9/16] overflow-hidden rounded-lg border transition ${config.background.kind === "image" && config.background.assetId === asset.id ? "border-[#ff715e] ring-2 ring-[#ff715e]/25" : "border-white/10 hover:border-white/35"}`}><span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${asset.src})` }} /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-black/20 px-1 py-1.5 text-[9px] font-bold leading-3 text-white">{asset.label}</span></button>)}</div>
              <div className="mt-6 border-t border-white/10 pt-5"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-neutral-200">단색 배경</h3><button type="button" aria-expanded={showAllBackgroundColors} onClick={() => setShowAllBackgroundColors((current) => !current)} className="text-[11px] font-bold text-[#ff9b8d] transition hover:text-white">{showAllBackgroundColors ? "접기" : "전체 보기"}</button></div><div className="mt-3 grid grid-cols-3 gap-2">{visibleBackgroundColors.map((option) => <button key={option.color} type="button" title={option.name} aria-label={`${option.name} 단색 배경 선택`} aria-pressed={selectedBackgroundColor === option.color} onClick={() => commit((next) => { next.background = { kind: "color", color: option.color }; return next; })} className={`relative aspect-[9/16] overflow-hidden rounded-lg border transition ${selectedBackgroundColor === option.color ? "border-[#ff715e] ring-2 ring-[#ff715e]/25" : "border-white/10 hover:border-white/35"}`} style={{ backgroundColor: option.color }}><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-black/20 px-1 py-1.5 text-[9px] font-bold leading-3 text-white">{option.name}</span></button>)}</div></div>
            </div></section>
          </div>
          <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#19191c]/95 p-5 backdrop-blur-xl"><button type="button" disabled={saving || !dirty} onClick={() => void save()} className="h-12 w-full rounded-xl bg-[#ff715e] text-sm font-black text-black transition hover:bg-[#ff8a78] disabled:bg-neutral-700 disabled:text-neutral-400">{saving ? "저장 중..." : savedTemplate ? "템플릿 저장" : "내 템플릿으로 저장"}</button>{message && <p className="mt-2 text-center text-[11px] leading-4 text-neutral-400">{message}</p>}</div>
        </aside>
      </div>
      <div className="grid min-h-dvh place-items-center px-6 text-center lg:hidden"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#ff715e]/10 text-2xl">▣</div><h1 className="mt-5 text-xl font-black">템플릿 편집은 데스크톱에서 이용해 주세요</h1><p className="mt-2 text-sm leading-6 text-neutral-500">1024px 이상의 화면에서 위치 이동과 크기 조절을 정확하게 사용할 수 있습니다.</p><Link href="/templates" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-black">템플릿 라이브러리로</Link></div></div>
    </div>
  );
}
