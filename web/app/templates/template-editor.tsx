"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  TEMPLATE_CANVAS,
  aspectHeightRatio,
  stockBackgrounds,
  templatePresetColors,
  videoFrameForAspect,
  type CustomTemplate,
  type TemplateConfig,
} from "@/lib/template-config";
import { videoAspectRatioOptions, type TemplateId, type VideoAspectRatio } from "@/lib/contracts";

type LayerId = "video" | "title" | "subtitle" | "channel";
type History = { past: TemplateConfig[]; present: TemplateConfig; future: TemplateConfig[] };

const layerLabels: Record<LayerId, string> = { video: "영상", title: "제목", subtitle: "자막", channel: "채널명" };

function cloneConfig(config: TemplateConfig) {
  return structuredClone(config);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function backgroundStyle(config: TemplateConfig): React.CSSProperties {
  if (config.background.kind === "color") return { backgroundColor: config.background.color };
  const assetId = config.background.assetId;
  const asset = stockBackgrounds.find((item) => item.id === assetId);
  return { backgroundImage: `url(${asset?.src || ""})`, backgroundPosition: "center", backgroundSize: "cover" };
}

function layerPosition(x: number, y: number, width: number): React.CSSProperties {
  return {
    left: `${(x / TEMPLATE_CANVAS.width) * 100}%`,
    top: `${(y / TEMPLATE_CANVAS.height) * 100}%`,
    width: `${(width / TEMPLATE_CANVAS.width) * 100}%`,
    transform: "translate(-50%, -50%)",
  };
}

function ColorPalette({ value, onChange, allowNone = false }: { value: string | null; onChange: (value: (typeof templatePresetColors)[number] | null) => void; allowNone?: boolean }) {
  return (
    <div className="grid grid-cols-7 gap-2">
      {allowNone && <button type="button" title="배경 없음" aria-label="배경 없음" aria-pressed={value === null} onClick={() => onChange(null)} className={`relative aspect-square rounded-md border ${value === null ? "border-[#ff715e] ring-2 ring-[#ff715e]/25" : "border-white/10"}`}><span className="absolute inset-x-1 top-1/2 h-px -rotate-45 bg-red-400" /></button>}
      {templatePresetColors.map((color) => (
        <button key={color} type="button" title={color} aria-label={color} aria-pressed={value === color} onClick={() => onChange(color)} className={`aspect-square rounded-md border ${value === color ? "border-white ring-2 ring-[#ff715e]/60" : "border-white/10"}`} style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

export function TemplateEditor({ initialTemplate, baseTemplateId, initialConfig }: { initialTemplate: CustomTemplate | null; baseTemplateId: TemplateId; initialConfig: TemplateConfig }) {
  const [history, setHistory] = useState<History>({ past: [], present: initialConfig, future: [] });
  const [name, setName] = useState(initialTemplate?.name || "나의 템플릿");
  const [selectedLayer, setSelectedLayer] = useState<LayerId>("title");
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedTemplate, setSavedTemplate] = useState(initialTemplate);
  const canvasRef = useRef<HTMLDivElement>(null);
  const transactionRef = useRef<TemplateConfig | null>(null);
  const baselineRef = useRef(JSON.stringify({ name: initialTemplate?.name || "나의 템플릿", config: initialConfig }));
  const config = history.present;
  const dirty = JSON.stringify({ name, config }) !== baselineRef.current;

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

  const beginPointerAction = (event: ReactPointerEvent, layer: LayerId, mode: "move" | "resize" = "move") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLayer(layer);
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
      updateTransient((next) => {
        if (layer === "video") {
          if (mode === "resize") {
            const ratio = aspectHeightRatio(next.video.aspectRatio);
            const maxWidth = Math.min(TEMPLATE_CANVAS.width - startConfig.video.x, (TEMPLATE_CANVAS.height - startConfig.video.y) / ratio);
            const width = Math.round(clamp(startConfig.video.width + dx, 240, maxWidth));
            next.video.width = width;
            next.video.height = Math.round(width * ratio);
          } else {
            next.video.x = clamp(startConfig.video.x + dx, 0, TEMPLATE_CANVAS.width - next.video.width);
            next.video.y = clamp(startConfig.video.y + dy, 0, TEMPLATE_CANVAS.height - next.video.height);
          }
        } else {
          const target = next[layer];
          target.x = clamp(startConfig[layer].x + dx, 0, TEMPLATE_CANVAS.width);
          target.y = clamp(startConfig[layer].y + dy, 0, TEMPLATE_CANVAS.height);
        }
        return next;
      });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
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

  const selectedTextLayer = selectedLayer === "video" ? null : config[selectedLayer];
  const background = backgroundStyle(config);
  const titleStyle = {
    ...layerPosition(config.title.x, config.title.y, config.title.maxWidth),
    color: config.title.primaryColor,
    fontSize: `${(config.title.fontSize / TEMPLATE_CANVAS.width) * 100}cqw`,
    backgroundColor: config.title.backgroundColor || "transparent",
  };

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

        <main className="min-h-dvh pb-10 pl-6 pr-[344px] pt-24">
          <div className="mx-auto flex max-w-[920px] flex-col items-center">
            <div className="mb-4 flex w-full max-w-[500px] items-center justify-between text-xs font-bold text-neutral-500"><span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-emerald-300">● LIVE PREVIEW</span><span>9:16 · 1080 × 1920</span></div>
            <div className="flex min-h-[680px] w-full items-center justify-center overflow-auto rounded-2xl border border-white/[.06] bg-[#09090a] p-8 shadow-inner">
              <div style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}>
                <div ref={canvasRef} className="relative aspect-[9/16] w-[360px] touch-none overflow-hidden rounded-[12px] shadow-[0_30px_100px_rgba(0,0,0,.65)]" style={{ ...background, containerType: "inline-size" }} onPointerDown={() => setSelectedLayer("video")}>
                  <div onPointerDown={(event) => beginPointerAction(event, "video")} className={`absolute cursor-move overflow-hidden bg-neutral-700 ${selectedLayer === "video" ? "ring-2 ring-[#ff715e] ring-inset" : ""}`} style={{ left: `${config.video.x / 10.8}%`, top: `${config.video.y / 19.2}%`, width: `${config.video.width / 10.8}%`, height: `${config.video.height / 19.2}%` }}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#73737c,#2c2c31_70%)]" /><div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
                    <button type="button" aria-label="영상 크기 조절" onPointerDown={(event) => beginPointerAction(event, "video", "resize")} className="absolute bottom-0 right-0 h-6 w-6 cursor-nwse-resize border-l border-t border-white bg-[#ff715e]" />
                  </div>
                  {config.title.visible && <button type="button" onPointerDown={(event) => beginPointerAction(event, "title")} className={`absolute z-20 cursor-move whitespace-pre-line rounded px-[1.8cqw] py-[1cqw] text-center font-black leading-[1.18] ${selectedLayer === "title" ? "outline outline-2 outline-[#ff715e]" : ""}`} style={titleStyle}>놓치면 후회할{`\n`}<span style={{ color: config.title.accentColor }}>핵심 한 가지</span></button>}
                  {config.channel.visible && <button type="button" onPointerDown={(event) => beginPointerAction(event, "channel")} className={`absolute z-30 cursor-move truncate rounded px-[1.8cqw] py-[.8cqw] text-center font-bold ${selectedLayer === "channel" ? "outline outline-2 outline-[#ff715e]" : ""}`} style={{ ...layerPosition(config.channel.x, config.channel.y, config.channel.maxWidth), color: config.channel.color, backgroundColor: config.channel.backgroundColor || "transparent", fontSize: `${config.channel.fontSize / 10.8}cqw` }}>● Easy Cut</button>}
                  {config.subtitle.visible && <button type="button" onPointerDown={(event) => beginPointerAction(event, "subtitle")} className={`absolute z-40 cursor-move truncate rounded px-[2cqw] py-[.8cqw] text-center font-bold ${selectedLayer === "subtitle" ? "outline outline-2 outline-[#ff715e]" : ""}`} style={{ ...layerPosition(config.subtitle.x, config.subtitle.y, config.subtitle.maxWidth), color: config.subtitle.color, backgroundColor: config.subtitle.backgroundColor || "transparent", fontSize: `${config.subtitle.fontSize / 10.8}cqw` }}>실제 자막이 이 위치에 표시됩니다</button>}
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-[#19191c] p-1"><button type="button" onClick={() => setZoom((value) => clamp(value - .1, .7, 1.2))} className="h-9 w-9 rounded-lg hover:bg-white/5">−</button><span className="w-14 text-center text-xs font-bold">{Math.round(zoom * 100)}%</span><button type="button" onClick={() => setZoom((value) => clamp(value + .1, .7, 1.2))} className="h-9 w-9 rounded-lg hover:bg-white/5">＋</button></div>
          </div>
        </main>

        <aside className="fixed bottom-0 right-0 top-16 z-40 flex w-80 flex-col border-l border-white/10 bg-[#19191c]">
          <div className="flex-1 space-y-7 overflow-y-auto px-5 pb-32 pt-6">
            <label className="block text-xs font-bold text-neutral-400">템플릿 이름<input value={name} maxLength={50} onChange={(event) => setName(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none focus:border-[#ff715e]" /></label>
            <section><h2 className="text-xs font-bold text-neutral-400">편집 레이어</h2><div className="mt-2 grid grid-cols-4 gap-1">{(Object.keys(layerLabels) as LayerId[]).map((layer) => <button key={layer} type="button" onClick={() => setSelectedLayer(layer)} className={`rounded-lg px-1 py-2 text-xs font-bold ${selectedLayer === layer ? "bg-[#ff715e] text-black" : "bg-white/5 text-neutral-400"}`}>{layerLabels[layer]}</button>)}</div></section>
            {selectedLayer === "video" && <section className="space-y-3"><h2 className="text-xs font-bold text-neutral-400">영상 비율</h2><div className="grid grid-cols-5 gap-1">{videoAspectRatioOptions.map((option) => <button key={option.value} type="button" onClick={() => changeAspect(option.value)} className={`rounded-lg py-2 text-[10px] font-bold ${config.video.aspectRatio === option.value ? "bg-white text-black" : "bg-white/5 text-neutral-400"}`}>{option.value}</button>)}</div><p className="text-[11px] leading-5 text-neutral-500">프레임을 끌어 이동하고 오른쪽 아래 핸들로 비율을 유지한 채 크기를 조절하세요.</p></section>}
            {selectedTextLayer && <>
              <section className="flex items-center justify-between"><span className="text-xs font-bold text-neutral-400">레이어 표시</span><button type="button" onClick={() => commit((next) => { next[selectedLayer as Exclude<LayerId, "video">].visible = !selectedTextLayer.visible; return next; })} className={`rounded-full px-3 py-1 text-xs font-bold ${selectedTextLayer.visible ? "bg-emerald-400 text-black" : "bg-white/10 text-neutral-400"}`}>{selectedTextLayer.visible ? "켜짐" : "꺼짐"}</button></section>
              <label className="block text-xs font-bold text-neutral-400">글자 크기 <span className="float-right text-white">{selectedTextLayer.fontSize}px</span><input type="range" min={selectedLayer === "channel" ? 20 : 24} max={selectedLayer === "title" ? 96 : selectedLayer === "subtitle" ? 72 : 64} value={selectedTextLayer.fontSize} onChange={(event) => commit((next) => { next[selectedLayer as Exclude<LayerId, "video">].fontSize = Number(event.target.value); return next; })} className="mt-3 w-full accent-[#ff715e]" /></label>
              <section><h2 className="mb-3 text-xs font-bold text-neutral-400">글자 색상</h2><ColorPalette value={selectedLayer === "title" ? config.title.primaryColor : selectedLayer === "subtitle" ? config.subtitle.color : config.channel.color} onChange={(color) => { if (!color) return; commit((next) => { if (selectedLayer === "title") next.title.primaryColor = color; else if (selectedLayer === "subtitle") next.subtitle.color = color; else next.channel.color = color; return next; }); }} /></section>
              {selectedLayer === "title" && <section><h2 className="mb-3 text-xs font-bold text-neutral-400">강조 색상</h2><ColorPalette value={config.title.accentColor} onChange={(color) => { if (color) commit((next) => { next.title.accentColor = color; return next; }); }} /></section>}
              <section><h2 className="mb-3 text-xs font-bold text-neutral-400">글자 배경</h2><ColorPalette allowNone value={selectedTextLayer.backgroundColor} onChange={(color) => commit((next) => { next[selectedLayer as Exclude<LayerId, "video">].backgroundColor = color; return next; })} /></section>
            </>}
            <section><h2 className="mb-3 text-xs font-bold text-neutral-400">배경 이미지</h2><div className="grid grid-cols-2 gap-2">{stockBackgrounds.map((asset) => <button key={asset.id} type="button" onClick={() => commit((next) => { next.background = { kind: "image", assetId: asset.id }; return next; })} className={`relative aspect-[9/12] overflow-hidden rounded-lg border ${config.background.kind === "image" && config.background.assetId === asset.id ? "border-[#ff715e] ring-2 ring-[#ff715e]/25" : "border-white/10"}`}><span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${asset.src})` }} /><span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-1 text-[10px] font-bold">{asset.label}</span></button>)}</div></section>
            <section><h2 className="mb-3 text-xs font-bold text-neutral-400">단색 배경</h2><ColorPalette value={config.background.kind === "color" ? config.background.color : null} onChange={(color) => { if (color) commit((next) => { next.background = { kind: "color", color }; return next; }); }} /></section>
          </div>
          <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#19191c]/95 p-5 backdrop-blur-xl"><button type="button" disabled={saving || !dirty} onClick={() => void save()} className="h-12 w-full rounded-xl bg-[#ff715e] text-sm font-black text-black transition hover:bg-[#ff8a78] disabled:bg-neutral-700 disabled:text-neutral-400">{saving ? "저장 중..." : savedTemplate ? "템플릿 저장" : "내 템플릿으로 저장"}</button>{message && <p className="mt-2 text-center text-[11px] leading-4 text-neutral-400">{message}</p>}</div>
        </aside>
      </div>
      <div className="grid min-h-dvh place-items-center px-6 text-center lg:hidden"><div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#ff715e]/10 text-2xl">▣</div><h1 className="mt-5 text-xl font-black">템플릿 편집은 데스크톱에서 이용해 주세요</h1><p className="mt-2 text-sm leading-6 text-neutral-500">1024px 이상의 화면에서 위치 이동과 크기 조절을 정확하게 사용할 수 있습니다.</p><Link href="/templates" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 text-sm font-bold text-black">템플릿 라이브러리로</Link></div></div>
    </div>
  );
}
